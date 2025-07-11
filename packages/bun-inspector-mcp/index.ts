import { createMcpHonoHttpStreamServer } from "./mcp.ts";

if (import.meta.main) {
  const app = createMcpHonoHttpStreamServer();
  console.warn("Starting MCP server on http://localhost:4000/mcp");
  Bun.serve({
    port: 4000,
    fetch: app.fetch,
  });
}
