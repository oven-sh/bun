// Simple HTTP/2 test with debug output
import * as http2 from "node:http2";
import * as fs from "node:fs";

console.log("Starting HTTP/2 test...");

// Create HTTP/2 server
const server = http2.createSecureServer({
  allowHTTP1: true,  // Allow HTTP/1.1 fallback for debugging
  settings: {
    enablePush: false,
  },
  key: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.key"),
  cert: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.pem"),
});

server.on("error", (err) => console.error("Server error:", err));

server.on("stream", (stream, headers) => {
  console.log("HTTP/2 stream received!");
  console.log("Headers:", headers);
  
  stream.respond({
    ":status": 200,
    "content-type": "text/plain",
  });
  
  stream.end("Hello from HTTP/2!");
});

// Also handle HTTP/1.1 requests for debugging
server.on("request", (req, res) => {
  console.log("HTTP/1.1 request received!");
  console.log("Protocol:", req.httpVersion);
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hello from HTTP/1.1!");
});

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`Server listening on port ${port}`);
  console.log("Server ALPN protocols:", server.alpnProtocols);
  
  try {
    console.log("\nAttempting fetch to https://localhost:" + port);
    
    // Try fetch with explicit HTTP version
    const response = await fetch(`https://localhost:${port}/test`, {
      headers: {
        "User-Agent": "Bun/test"
      },
      // @ts-ignore
      tls: { 
        rejectUnauthorized: false
      }
    });
    
    console.log("Fetch completed!");
    console.log("Status:", response.status);
    const text = await response.text();
    console.log("Response:", text);
    
  } catch (err) {
    console.error("Fetch error:", err);
  } finally {
    server.close();
  }
});