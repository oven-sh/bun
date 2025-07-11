import type { WebSocketInspector } from "bun-inspector-protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { remoteObjectToString } from "bun-inspector-protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as Pkg from "./package.json";
import { getInspector, consoleMessagesMap, callFramesMap, heapSnapshotsMap, gcEventsMap, cpuProfilesMap } from "./inspector";

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
          url: fileUrl as string,
          lineNumber: lineNumber as number,
          columnNumber: columnNumber as number | undefined,
          options: {
            condition: condition as string | undefined,
            autoContinue: autoContinue as boolean | undefined,
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
            condition: condition as string | undefined,
            autoContinue: autoContinue as boolean | undefined,
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

  // Debugger control flow tools
  server.registerTool(
    "Debugger.pause",
    {
      title: "pause debugger",
      description: "Pause JavaScript execution on the next statement",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.pause");
        return {
          content: [
            {
              type: "text" as const,
              text: "Debugger will pause on the next statement",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to pause debugger: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.resume",
    {
      title: "resume debugger",
      description: "Resume JavaScript execution when paused",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.resume");
        return {
          content: [
            {
              type: "text" as const,
              text: "Debugger resumed execution",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to resume debugger: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.stepInto",
    {
      title: "step into",
      description: "Step into the next function call when paused",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.stepInto");
        return {
          content: [
            {
              type: "text" as const,
              text: "Stepped into the next function call",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to step into: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.stepOver",
    {
      title: "step over",
      description: "Step over the current line when paused",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.stepOver");
        return {
          content: [
            {
              type: "text" as const,
              text: "Stepped over the current line",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to step over: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.stepOut",
    {
      title: "step out",
      description: "Step out of the current function when paused",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.stepOut");
        return {
          content: [
            {
              type: "text" as const,
              text: "Stepped out of the current function",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to step out: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.continueToLocation",
    {
      title: "continue to location",
      description: "Continue execution to a specific location when paused",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        scriptId: z.string().describe("Script ID to continue to"),
        lineNumber: z.number().int().min(0).describe("Line number to continue to (0-based)"),
        columnNumber: z.number().int().min(0).optional().describe("Column number to continue to (0-based)"),
      },
    },
    async ({ url, scriptId, lineNumber, columnNumber }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.continueToLocation", {
          location: {
            scriptId: scriptId as string,
            lineNumber: lineNumber as number,
            columnNumber: columnNumber as number | undefined,
          },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Continuing to ${scriptId}:${lineNumber}${columnNumber !== undefined ? `:${columnNumber}` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to continue to location: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.setPauseOnExceptions",
    {
      title: "set pause on exceptions",
      description: "Configure the debugger to pause on exceptions",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        state: z.enum(["none", "uncaught", "all"]).describe("Exception pause mode: none, uncaught, or all"),
      },
    },
    async ({ url, state }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Debugger.setPauseOnExceptions", {
          state: state as "none" | "uncaught" | "all",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Exception pause mode set to: ${state}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to set pause on exceptions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Debugger.evaluateOnCallFrame",
    {
      title: "evaluate on call frame",
      description: "Evaluate JavaScript expression in the context of a paused call frame",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        callFrameId: z.string().describe("Call frame ID to evaluate in"),
        expression: z.string().describe("JavaScript expression to evaluate"),
        objectGroup: z.string().optional().describe("Symbolic group name for result"),
        includeCommandLineAPI: z.boolean().optional().describe("Include command line API in evaluation context"),
        returnByValue: z.boolean().optional().describe("Return result by value instead of reference"),
      },
    },
    async ({ url, callFrameId, expression, objectGroup, includeCommandLineAPI, returnByValue }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Debugger.evaluateOnCallFrame", {
          callFrameId: callFrameId as string,
          expression: expression as string,
          objectGroup: objectGroup as string | undefined,
          includeCommandLineAPI: includeCommandLineAPI as boolean | undefined,
          returnByValue: returnByValue as boolean | undefined,
        });
        
        const resultString = remoteObjectToString(result.result, true);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                result: resultString,
                wasThrown: result.wasThrown,
                exceptionDetails: result.exceptionDetails,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to evaluate on call frame: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // Heap profiling tools
  server.registerTool(
    "Heap.enable",
    {
      title: "enable heap profiling",
      description: "Enable heap profiling events including garbage collection tracking",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.enable");
        return {
          content: [
            {
              type: "text" as const,
              text: "Heap profiling enabled successfully",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to enable heap profiling: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Heap.disable",
    {
      title: "disable heap profiling",
      description: "Disable heap profiling events",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.disable");
        return {
          content: [
            {
              type: "text" as const,
              text: "Heap profiling disabled successfully",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to disable heap profiling: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Heap.snapshot",
    {
      title: "take heap snapshot",
      description: "Take a heap memory snapshot",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Heap.snapshot");
        
        // Store the snapshot
        const urlObj = new URL(url as string);
        const snapshots = heapSnapshotsMap.get(urlObj) ?? [];
        heapSnapshotsMap.set(urlObj, [...snapshots, { timestamp: result.timestamp, snapshotData: result.snapshotData }]);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                timestamp: result.timestamp,
                snapshotSize: result.snapshotData.length,
                message: `Heap snapshot taken at timestamp ${result.timestamp}. Snapshot data length: ${result.snapshotData.length} characters`,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to take heap snapshot: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Heap.gc",
    {
      title: "trigger garbage collection",
      description: "Trigger a full garbage collection",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.gc");
        return {
          content: [
            {
              type: "text" as const,
              text: "Garbage collection triggered successfully",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to trigger garbage collection: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Heap.startTracking",
    {
      title: "start heap tracking",
      description: "Start tracking heap memory changes. This will produce a trackingStart event with initial snapshot.",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.startTracking");
        return {
          content: [
            {
              type: "text" as const,
              text: "Heap tracking started. Initial snapshot will be available in trackingStart event.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start heap tracking: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Heap.stopTracking",
    {
      title: "stop heap tracking",
      description: "Stop tracking heap memory changes. This will produce a trackingComplete event with final snapshot.",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.stopTracking");
        return {
          content: [
            {
              type: "text" as const,
              text: "Heap tracking stopped. Final snapshot will be available in trackingComplete event.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to stop heap tracking: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "getHeapSnapshots",
    {
      title: "get heap snapshots",
      description: "Get all heap snapshots that have been taken",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const snapshots = heapSnapshotsMap.get(new URL(url as string)) ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              count: snapshots.length,
              snapshots: snapshots.map(s => ({
                timestamp: s.timestamp,
                snapshotSize: s.snapshotData.length,
              })),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "getGCEvents",
    {
      title: "get garbage collection events",
      description: "Get all garbage collection events that have occurred",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const gcEvents = gcEventsMap.get(new URL(url as string)) ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              count: gcEvents.length,
              events: gcEvents,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "Heap.getPreview",
    {
      title: "get heap object preview",
      description: "Get a preview (string, function details, or object preview) for a heap object ID",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        heapObjectId: z.number().int().describe("Identifier of the heap object within the snapshot"),
      },
    },
    async ({ url, heapObjectId }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Heap.getPreview", {
          heapObjectId: heapObjectId as number,
        });
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                string: result.string,
                functionDetails: result.functionDetails,
                preview: result.preview,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get heap object preview: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Heap.getRemoteObject",
    {
      title: "get heap remote object",
      description: "Get the strongly referenced Runtime.RemoteObject for a heap object ID",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        heapObjectId: z.number().int().describe("Identifier of the heap object within the snapshot"),
        objectGroup: z.string().optional().describe("Symbolic group name for object release"),
      },
    },
    async ({ url, heapObjectId, objectGroup }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Heap.getRemoteObject", {
          heapObjectId: heapObjectId as number,
          objectGroup: objectGroup as string | undefined,
        });
        
        const resultString = remoteObjectToString(result.result, true);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                objectString: resultString,
                remoteObject: result.result,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get heap remote object: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  // CPU profiling tools
  server.registerTool(
    "ScriptProfiler.startTracking",
    {
      title: "start CPU profiling",
      description: "Start tracking script evaluations with optional sampling profiler",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        includeSamples: z.boolean().optional().describe("Enable sampling profiler (default: false)"),
      },
    },
    async ({ url, includeSamples }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("ScriptProfiler.startTracking", {
          includeSamples: includeSamples as boolean | undefined,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `CPU profiling started${includeSamples ? " with sampling enabled" : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to start CPU profiling: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "ScriptProfiler.stopTracking",
    {
      title: "stop CPU profiling",
      description: "Stop tracking script evaluations. This will produce a trackingComplete event with profiling data.",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("ScriptProfiler.stopTracking");
        return {
          content: [
            {
              type: "text" as const,
              text: "CPU profiling stopped. Profile data will be available in trackingComplete event.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to stop CPU profiling: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "getCPUProfiles",
    {
      title: "get CPU profiles",
      description: "Get all CPU profiling data that has been collected",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const profiles = cpuProfilesMap.get(new URL(url as string)) ?? [];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              count: profiles.length,
              profiles: profiles.map(p => ({
                timestamp: p.timestamp,
                hasSamples: !!p.samples,
                stackTraceCount: p.samples?.stackTraces?.length ?? 0,
              })),
            }),
          },
        ],
      };
    },
  );

  // Runtime object inspection tools
  server.registerTool(
    "Runtime.getProperties",
    {
      title: "get object properties",
      description: "Get properties of a remote object",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        objectId: z.string().describe("Remote object ID to get properties for"),
        ownProperties: z.boolean().optional().describe("Return only own properties (default: true)"),
        accessorPropertiesOnly: z.boolean().optional().describe("Return only accessor properties (default: false)"),
        generatePreview: z.boolean().optional().describe("Generate preview for property values (default: false)"),
      },
    },
    async ({ url, objectId, ownProperties, accessorPropertiesOnly, generatePreview }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Runtime.getProperties", {
          objectId: objectId as string,
          ownProperties: ownProperties as boolean | undefined,
          accessorPropertiesOnly: accessorPropertiesOnly as boolean | undefined,
          generatePreview: generatePreview as boolean | undefined,
        });
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                properties: result.result,
                internalProperties: result.internalProperties,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get object properties: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Runtime.callFunctionOn",
    {
      title: "call function on object",
      description: "Call a function on a remote object",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        functionDeclaration: z.string().describe("Function declaration to call"),
        objectId: z.string().optional().describe("Object to call function on"),
        arguments: z.array(z.any()).optional().describe("Arguments to pass to function"),
        returnByValue: z.boolean().optional().describe("Return result by value (default: false)"),
        generatePreview: z.boolean().optional().describe("Generate preview for result (default: false)"),
      },
    },
    async ({ url, functionDeclaration, objectId, arguments: args, returnByValue, generatePreview }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Runtime.callFunctionOn", {
          functionDeclaration: functionDeclaration as string,
          objectId: objectId as string | undefined,
          arguments: args as any[] | undefined,
          returnByValue: returnByValue as boolean | undefined,
          generatePreview: generatePreview as boolean | undefined,
        });
        
        const resultString = remoteObjectToString(result.result, true);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                result: resultString,
                wasThrown: result.wasThrown,
                exceptionDetails: result.exceptionDetails,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to call function: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "Runtime.awaitPromise",
    {
      title: "await promise",
      description: "Wait for a promise to resolve and return the result",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
        promiseObjectId: z.string().describe("Remote object ID of the promise"),
        returnByValue: z.boolean().optional().describe("Return result by value (default: false)"),
        generatePreview: z.boolean().optional().describe("Generate preview for result (default: false)"),
      },
    },
    async ({ url, promiseObjectId, returnByValue, generatePreview }) => {
      const inspector = getInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Runtime.awaitPromise", {
          promiseObjectId: promiseObjectId as string,
          returnByValue: returnByValue as boolean | undefined,
          generatePreview: generatePreview as boolean | undefined,
        });
        
        const resultString = remoteObjectToString(result.result, true);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                result: resultString,
                wasThrown: result.wasThrown,
                exceptionDetails: result.exceptionDetails,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to await promise: ${error instanceof Error ? error.message : String(error)}`,
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
