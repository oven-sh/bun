// Test HTTP/2 with node:http2 server and fetch() client
import * as http2 from "node:http2";
import * as fs from "node:fs";

// Create HTTP/2 server
const server = http2.createSecureServer({
  allowHTTP1: false,
  settings: {
    enablePush: false,
  },
  key: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.key"),
  cert: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.pem"),
});

server.on("error", (err) => console.error("Server error:", err));

server.on("stream", (stream, headers) => {
  console.log("Server received headers:", headers);
  
  stream.respond({
    ":status": 200,
    "content-type": "application/json",
    "x-test-header": "http2-works",
  });
  
  stream.end(JSON.stringify({
    message: "Hello from HTTP/2 server",
    method: headers[":method"],
    path: headers[":path"],
    protocol: "HTTP/2",
  }));
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`HTTP/2 server listening on port ${port}`);
  
  try {
    // Use fetch() to make request to HTTP/2 server
    const response = await fetch(`https://localhost:${port}/test`, {
      headers: {
        "User-Agent": "Bun/fetch-test"
      },
      // @ts-ignore - Bun-specific option
      tls: { rejectUnauthorized: false }
    });
    
    console.log("Fetch response status:", response.status);
    console.log("Fetch response headers:", Object.fromEntries(response.headers.entries()));
    
    const data = await response.json();
    console.log("Fetch response data:", data);
    
  } catch (err) {
    console.error("Fetch error:", err);
  } finally {
    server.close();
  }
});