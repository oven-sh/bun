import { createMcpHonoHttpStreamServer } from "./mcp.ts";

if (import.meta.main) {
  const app = createMcpHonoHttpStreamServer();
  console.warn("Starting MCP server on http://localhost:4001/mcp");
  Bun.serve({
    port: 4001,
    fetch: app.fetch,
  });
}
