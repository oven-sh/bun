import { createMcpHonoHttpStreamServer } from "./mcp";

// Create the server
const app = createMcpHonoHttpStreamServer();

// Start server on a test port
const port = 3333;
console.log(`Starting test server on port ${port}...`);

// Simulate multiple requests to test connection persistence
async function testPersistence() {
  console.log("\n=== Testing Connection Persistence ===\n");
  
  // First request - register inspector
  console.log("Request 1: Registering inspector...");
  const response1 = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "registerInspector",
        arguments: {
          url: "ws://localhost:9229"
        }
      },
      id: 1
    })
  });
  console.log("Response 1:", await response1.text());
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Second request - evaluate expression
  console.log("\nRequest 2: Evaluating expression...");
  const response2 = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "Runtime.evaluate",
        arguments: {
          url: "ws://localhost:9229",
          expression: "1 + 1"
        }
      },
      id: 2
    })
  });
  console.log("Response 2:", await response2.text());
  
  // Third request - check if connection is still alive
  console.log("\nRequest 3: Evaluating another expression...");
  const response3 = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "Runtime.evaluate",
        arguments: {
          url: "ws://localhost:9229",
          expression: "process.version"
        }
      },
      id: 3
    })
  });
  console.log("Response 3:", await response3.text());
  
  console.log("\n=== Test Complete ===");
  console.log("If you see responses for all 3 requests, the connection was persisted!");
}

// Start the server
const server = Bun.serve({
  port,
  fetch: app.fetch
});

// Run the test after server starts
setTimeout(testPersistence, 1000);

// Keep the process alive
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.stop();
  process.exit(0);
});