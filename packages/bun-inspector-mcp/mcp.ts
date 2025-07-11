import type { WebSocketInspector } from "bun-inspector-protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { remoteObjectToString } from "bun-inspector-protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as Pkg from "./package.json";
import { getInspector, consoleMessagesMap, callFramesMap } from "./inspector";

export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: `mcp server for bun inspector`,
    version: Pkg.version,
  });

  server.registerTool(
    "registerInspector",
    {
      title: "register inspector",
      description: "Register a new inspector URL",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to register"),
      },
    },
    async ({ url }) => {
      const inspectorUrl = new URL(url);

      const inspector = getInspector({ url: inspectorUrl });
      return {
        content: [
          {
            type: "text" as const,
            text: `Inspector registered at ${inspectorUrl}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "Runtime.evaluate",
    {
      title: "runtime evaluate",
      description: "Evaluate JavaScript code in the runtime",
      inputSchema: {
        expression: z.string().min(1).describe("JavaScript code to evaluate"),
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ expression, url }) => {
      const inspector = getInspector({ url: new URL(url) });
      const result = await inspector.send("Runtime.evaluate", {
        expression,
      });
      const resultString = remoteObjectToString(result.result, true);
      return {
        content: [
          {
            type: "text" as const,
            text: resultString,
          },
        ],
      };
    },
  );

  server.registerTool(
    "Debugger.getScriptSource",
    {
      title: "get script source",
      description: "Get the source code of a script by its ID",
      inputSchema: {
        scriptId: z.string().min(1).describe("ID of the script to get the source for"),
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ scriptId, url }) => {
      const inspector = getInspector({ url: new URL(url) });
      const result = await inspector.send("Debugger.getScriptSource", {
        scriptId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: result.scriptSource,
          },
        ],
      };
    },
  );

  server.registerTool(
    "getConsoleMessages",
    {
      title: "get console messages",
      description: "Get console messages from the inspector",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
      outputSchema: {
        data: z
          .array(
            z.object({
              date: z.string().describe("ISO string of the date the message was logged"),
              message: z.string().describe("The console message"),
            }),
          )
          .describe("Array of console messages"),
      },
    },
    async ({ url }) => {
      const messages = consoleMessagesMap.get(new URL(url)) ?? [];
      const data = {
        data: messages.map(msg => ({
          date: msg.date.toISOString(),
          message: msg.message,
        })),
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data),
          },
        ],
      };
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("MCP Server running on stdio");
}
