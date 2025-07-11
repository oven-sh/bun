#!/usr/bin/env bun
import { startMemoryMcpServer } from "./memory-mcp";

startMemoryMcpServer().catch(error => {
  console.error("Failed to start Memory MCP server:", error);
  process.exit(1);
});