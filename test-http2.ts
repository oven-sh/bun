// Test HTTP/2 server using node:http2 module
import * as http2 from "node:http2";
import * as fs from "node:fs";

// Create a self-signed certificate for testing
const serverOptions = {
  allowHTTP1: false,
  settings: {
    enablePush: false,
  }
};

// Create HTTP/2 server
const server = http2.createSecureServer({
  ...serverOptions,
  key: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.key"),
  cert: fs.readFileSync("/home/claude/bun/test/js/bun/http/fixtures/cert.pem"),
});

server.on("error", (err) => console.error("Server error:", err));

server.on("stream", (stream, headers) => {
  console.log("Received request headers:", headers);
  
  // Respond with HTTP/2
  stream.respond({
    ":status": 200,
    "content-type": "text/plain",
    "x-custom-header": "test-value",
  });
  
  stream.write("Hello from HTTP/2 server!\n");
  stream.write("Method: " + headers[":method"] + "\n");
  stream.write("Path: " + headers[":path"] + "\n");
  stream.end();
});

server.listen(0, () => {
  const port = server.address().port;
  console.log(`HTTP/2 server listening on port ${port}`);
  
  // Create client to test
  const client = http2.connect(`https://localhost:${port}`, {
    rejectUnauthorized: false
  });
  
  const req = client.request({
    ":path": "/test",
    ":method": "GET",
  });
  
  req.on("response", (headers) => {
    console.log("Client received response headers:", headers);
    console.log("Status:", headers[":status"]);
  });
  
  let data = "";
  req.on("data", (chunk) => {
    data += chunk;
  });
  
  req.on("end", () => {
    console.log("Client received data:", data);
    client.close();
    server.close();
  });
  
  req.end();
});