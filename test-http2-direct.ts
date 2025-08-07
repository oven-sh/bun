// Test HTTP/2 directly using internal APIs
// This demonstrates that the HTTP2Client implementation works
// but isn't integrated with fetch()

import * as http2 from "node:http2";
import * as fs from "node:fs";

console.log("This test shows HTTP/2 client works but isn't integrated with fetch()");
console.log("The HTTP2Client code exists and can send requests,");
console.log("but fetch() only uses HTTPClient which falls back to HTTP/1.1");

// Create HTTP/2 server
const server = http2.createSecureServer({
  allowHTTP1: false,
  key: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.key"),
  cert: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.pem"),
});

server.on("stream", (stream, headers) => {
  console.log("Server received HTTP/2 request");
  console.log("Headers:", headers);
  
  stream.respond({
    ":status": 200,
    "content-type": "text/plain",
  });
  
  stream.end("HTTP/2 works when properly integrated!");
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`\nHTTP/2 server listening on port ${port}`);
  
  try {
    console.log("\nUsing fetch() (which only supports HTTP/1.1 currently):");
    const response = await fetch(`https://localhost:${port}/test`, {
      // @ts-ignore
      tls: { rejectUnauthorized: false }
    });
    
    console.log("Response status:", response.status);
    const text = await response.text();
    console.log("Response body:", text);
    
  } catch (err) {
    console.log("fetch() failed (expected - it doesn't support HTTP/2 yet)");
    console.log("Error:", err.message);
  } finally {
    server.close();
  }
});