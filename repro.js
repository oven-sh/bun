// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
// This test ensures that the data received through tls over http tunnel
// is same as what is sent.

const assert = require("assert");
const https = require("https");
const net = require("net");
const http = require("http");
const fs = require("fs");

console.log("DEBUG: Starting test setup");

// test/js/node/tls/fixtures/agent1-key.pem
// test/js/node/tls/fixtures/agent1-cert.pem
const key = fs.readFileSync("test/js/node/tls/fixtures/agent1-key.pem");
const cert = fs.readFileSync("test/js/node/tls/fixtures/agent1-cert.pem");
console.log("DEBUG: Loaded SSL certificates");

const options = { key, cert };

const server = https.createServer(options, (req, res) => {
  console.log("SERVER: got request");
  console.log("DEBUG: Request headers:", req.headers);
  res.writeHead(200, {
    "content-type": "text/plain",
  });
  console.log("SERVER: sending response");
  res.end("hello world\n");
});

const proxy = net.createServer(clientSocket => {
  console.log("PROXY: got a client connection");
  clientSocket.on("data", chunk => {
    console.log("PROXY: got data: \n====\n" + chunk.toString() + "\n====");
    process.exit(0);
  });
});

server.listen(0, () => {
  console.log("DEBUG: HTTPS server listening on port:", server.address().port);
});

proxy.listen(0, () => {
  console.log("DEBUG: Proxy server listening on port:", proxy.address().port);
  console.log("CLIENT: Making CONNECT request");

  const req = http.request({
    port: proxy.address().port,
    method: "CONNECT",
    path: `localhost:${server.address().port}`,
    headers: {
      "Proxy-Connections": "keep-alive",
    },
  });
  console.log("DEBUG: Request options:", {
    port: proxy.address().port,
    path: `localhost:${server.address().port}`,
  });

  req.useChunkedEncodingByDefault = false; // for v0.6
  req.end();
});
