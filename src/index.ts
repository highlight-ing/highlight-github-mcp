#!/usr/bin/env node
import { Server } from '@highlight-ai/mcp-sdk/server/index.js'
import { StdioServerTransport } from '@highlight-ai/mcp-sdk/server/stdio.js'
import {
    ListToolsRequestSchema,
    GetAuthTokenRequestSchema,
    CallToolRequestSchema,
    ErrorCode,
    McpError,
} from '@highlight-ai/mcp-sdk/types.js'
import { z } from 'zod'
import { Octokit } from '@octokit/rest'

async function getPRDiff(owner: string, repo: string, pullNumber: number, token: string): Promise<string> {
    const octokit = new Octokit({
        auth: token,
    })

    const response = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: {
            format: 'diff',
        },
    })

    return response.data as unknown as string
}

class GithubServer {
    private server: Server
    private githubToken: string

    constructor() {
        const token = process.env.GITHUB_TOKEN
        if (!token) {
            throw new Error('GITHUB_TOKEN environment variable is required')
        }
        this.githubToken = token

        this.server = new Server(
            {
                name: 'github-server',
                version: '0.0.1',
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            },
        )

        this.setupHandlers()
        this.setupErrorHandling()
    }

    private setupErrorHandling(): void {
        this.server.onerror = (error) => {
            console.error('[MCP Error]', error)
        }

        process.on('SIGINT', async () => {
            await this.server.close()
            process.exit(0)
        })
    }

    private setupHandlers(): void {
        this.setupToolHandlers()
    }

    private setupToolHandlers(): void {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'get_pr_diff',
                    description: 'Get the diff of a pull request',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            owner: {
                                type: 'string',
                                description: 'The owner of the repository',
                            },
                            repo: {
                                type: 'string',
                                description: 'The repository name',
                            },
                            pullNumber: {
                                type: 'number',
                                description: 'The pull request number',
                            },
                        },
                        required: ['owner', 'repo', 'pullNumber'],
                    },
                },
            ],
        }))

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (request.params.name !== 'get_pr_diff') {
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
            }

            const pullRequestParamsSchema = z.object({
                owner: z.string(),
                repo: z.string(),
                pullNumber: z.number(),
            })

            const parsedParams = pullRequestParamsSchema.safeParse(request.params.arguments)
            if (!parsedParams.success) {
                throw new Error('Invalid arguments')
            }

            const diff = await getPRDiff(
                parsedParams.data.owner,
                parsedParams.data.repo,
                parsedParams.data.pullNumber,
                this.githubToken
            )

            return {
                content: [
                    {
                        type: 'text',
                        text: diff,
                    },
                ],
            }
        })
    }

    async run(): Promise<void> {
        const transport = new StdioServerTransport()
        await this.server.connect(transport)
        console.log('Github MCP server running on stdio')
    }
}

const server = new GithubServer()
server.run().catch(console.error)
