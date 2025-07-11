import type { WebSocketInspector } from "bun-inspector-protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { remoteObjectToString } from "bun-inspector-protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as Pkg from "./package.json";
import { createInspector } from "./inspector";

interface McpServerOptions {
  inspector: WebSocketInspector;
}
export async function createMcpServer({ inspector }: McpServerOptions): Promise<McpServer> {
  const server = new McpServer({
    name: `mcp server for ${inspector.url}`,
    version: Pkg.version,
  });

  server.registerTool(
    "Runtime.evaluate",
    {
      title: "runtime evaluate",
      description: "Evaluate JavaScript code in the runtime",
      inputSchema: {
        expression: z.string().min(1).describe("JavaScript code to evaluate"),
      },
    },
    async ({ expression }) => {
      const result = await inspector.send("Runtime.evaluate", {
        expression,
      });
      const resultString = remoteObjectToString(result.result, true);
      return {
        content: [
          {
            type: "text",
            text: resultString,
          },
        ],
      };
    },
  );

  return server;
}

interface StartMcpServerOptions {
  url: URL;
}
export async function startMcpServer({ url }: StartMcpServerOptions): Promise<void> {
  const inspector = createInspector({ url });
  const server = await createMcpServer({ inspector });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("MCP Server running on stdio");
}
