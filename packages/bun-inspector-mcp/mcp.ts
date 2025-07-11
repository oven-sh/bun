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

  server.registerTool(
    "Debugger.setBreakpointByUrl",
    {
      title: "set breakpoint by URL",
      description: "Set a JavaScript breakpoint at a given line in a file specified by URL",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        fileUrl: z.string().url().describe("URL of the file to set the breakpoint in"),
        lineNumber: z.number().int().min(0).describe("Line number to set breakpoint at (0-based)"),
        columnNumber: z.number().int().min(0).optional().describe("Column number to set breakpoint at (0-based)"),
        condition: z.string().optional().describe("Condition for the breakpoint to trigger"),
        autoContinue: z
          .boolean()
          .optional()
          .describe("Whether to automatically continue execution after hitting the breakpoint"),
      },
    },
    async ({ url, fileUrl, lineNumber, columnNumber, condition, autoContinue }) => {
      const inspector = getInspector({ url: new URL(url as string) });

      try {
        const result = await inspector.send("Debugger.setBreakpointByUrl", {
          url: fileUrl,
          lineNumber,
          columnNumber,
          options: {
            condition,
            autoContinue,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                breakpointId: result.breakpointId,
                locations: result.locations,
                message: `Breakpoint ${result.breakpointId} set at ${fileUrl}:${lineNumber}${columnNumber !== undefined ? `:${columnNumber}` : ""}`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to set breakpoint: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.setBreakpoint",
    {
      title: "set breakpoint",
      description: "Set a JavaScript breakpoint at a given location using script ID",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        scriptId: z.string().describe("Script ID where to set the breakpoint"),
        lineNumber: z.number().int().min(0).describe("Line number to set breakpoint at (0-based)"),
        columnNumber: z.number().int().min(0).optional().describe("Column number to set breakpoint at (0-based)"),
        condition: z.string().optional().describe("Condition for the breakpoint to trigger"),
        autoContinue: z
          .boolean()
          .optional()
          .describe("Whether to automatically continue execution after hitting the breakpoint"),
      },
    },
    async ({ url, scriptId, lineNumber, columnNumber, condition, autoContinue }) => {
      const inspector = getInspector({ url: new URL(url as string) });

      try {
        const result = await inspector.send("Debugger.setBreakpoint", {
          location: {
            scriptId: scriptId as string,
            lineNumber: lineNumber as number,
            columnNumber: columnNumber as number | undefined,
          },
          options: {
            condition,
            autoContinue,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                breakpointId: result.breakpointId,
                actualLocation: result.actualLocation,
                message: `Breakpoint ${result.breakpointId} set at script ${scriptId}:${lineNumber}${columnNumber !== undefined ? `:${columnNumber}` : ""}`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to set breakpoint: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.removeBreakpoint",
    {
      title: "remove breakpoint",
      description: "Remove a JavaScript breakpoint by its ID",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        breakpointId: z.string().describe("ID of the breakpoint to remove"),
      },
    },
    async ({ url, breakpointId }) => {
      const inspector = getInspector({ url: new URL(url as string) });

      try {
        await inspector.send("Debugger.removeBreakpoint", {
          breakpointId: breakpointId as string,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Breakpoint ${breakpointId} removed successfully`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to remove breakpoint: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.setBreakpointsActive",
    {
      title: "toggle breakpoints active",
      description: "Activate or deactivate all breakpoints",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        active: z.boolean().describe("Whether breakpoints should be active"),
      },
    },
    async ({ url, active }) => {
      const inspector = getInspector({ url: new URL(url as string) });

      try {
        await inspector.send("Debugger.setBreakpointsActive", {
          active: active as boolean,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Breakpoints ${active ? "activated" : "deactivated"} successfully`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to ${active ? "activate" : "deactivate"} breakpoints: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
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
