import type { WebSocketInspector } from "bun-inspector-protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as Pkg from "./package.json";
import { getMemoryInspector, heapSnapshotsMap, gcEventsMap } from "./memory-profiler";

export async function createMemoryMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: `mcp server for bun memory profiler`,
    version: Pkg.version,
  });

  server.registerTool(
    "registerMemoryInspector",
    {
      title: "register memory inspector",
      description: "Register a new inspector URL for memory profiling",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to register"),
      },
    },
    async ({ url }) => {
      const inspectorUrl = new URL(url);
      const inspector = getMemoryInspector({ url: inspectorUrl });
      
      return {
        content: [
          {
            type: "text" as const,
            text: `Memory inspector registered at ${inspectorUrl}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "Heap.startTracking",
    {
      title: "start heap tracking",
      description: "Start tracking heap memory changes",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getMemoryInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.startTracking");
        
        return {
          content: [
            {
              type: "text" as const,
              text: "Heap tracking started successfully",
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
    "Heap.getGCEvents",
    {
      title: "get garbage collection events",
      description: "Get garbage collection events that occurred during profiling",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
      outputSchema: {
        gcEvents: z.array(
          z.object({
            type: z.string().describe("Type of GC (full, partial, etc.)"),
            startTime: z.number().describe("Start time of GC"),
            endTime: z.number().describe("End time of GC"),
          }).passthrough()
        ).describe("Array of garbage collection events"),
      },
    },
    async ({ url }) => {
      const gcEvents = gcEventsMap.get(new URL(url as string)) ?? [];
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              gcEvents: gcEvents,
            }),
          },
        ],
      };
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
      const inspector = getMemoryInspector({ url: new URL(url as string) });
      
      try {
        const result = await inspector.send("Heap.snapshot");
        
        // Store the snapshot
        const snapshots = heapSnapshotsMap.get(new URL(url as string)) ?? [];
        heapSnapshotsMap.set(new URL(url as string), [...snapshots, result]);
        
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                timestamp: result.timestamp,
                snapshotData: result.snapshotData,
                message: "Heap snapshot taken successfully",
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
    "Heap.stopTracking", 
    {
      title: "stop heap tracking",
      description: "Stop tracking heap memory changes",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getMemoryInspector({ url: new URL(url as string) });
      
      try {
        await inspector.send("Heap.stopTracking");
        
        return {
          content: [
            {
              type: "text" as const,
              text: "Heap tracking stopped successfully",
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
    "Heap.gc",
    {
      title: "trigger garbage collection",
      description: "Manually trigger garbage collection",
      inputSchema: {
        url: z.string().url().describe("URL of the inspector to use"),
      },
    },
    async ({ url }) => {
      const inspector = getMemoryInspector({ url: new URL(url as string) });
      
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

  return server;
}

export async function startMemoryMcpServer(): Promise<void> {
  const server = await createMemoryMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.info("Memory MCP Server running on stdio");
}