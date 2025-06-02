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

// test/js/node/tls/fixtures/agent1-key.pem
// test/js/node/tls/fixtures/agent1-cert.pem
const key = fs.readFileSync("test/js/node/tls/fixtures/agent1-key.pem");
const cert = fs.readFileSync("test/js/node/tls/fixtures/agent1-cert.pem");

const options = { key, cert };

const server = https.createServer(options, (req, res) => {
  console.log("SERVER: got request");
  res.writeHead(200, {
    "content-type": "text/plain",
  });
  console.log("SERVER: sending response");
  res.end("hello world\n");
});

const proxy = net.createServer(clientSocket => {
  console.log("PROXY: got a client connection");

  let serverSocket = null;

  clientSocket.on("data", chunk => {
    if (!serverSocket) {
      // Verify the CONNECT request
      assert.strictEqual(
        chunk.toString(),
        `CONNECT localhost:${server.address().port} ` +
          "HTTP/1.1\r\n" +
          "Proxy-Connections: keep-alive\r\n" +
          `Host: localhost:${proxy.address().port}\r\n` +
          "Connection: keep-alive\r\n\r\n",
      );

      console.log("PROXY: got CONNECT request");
      console.log("PROXY: creating a tunnel");

      // create the tunnel
      serverSocket = net.connect(server.address().port, () => {
        console.log("PROXY: replying to client CONNECT request");

        // Send the response
        clientSocket.write(
          "HTTP/1.1 200 OK\r\nProxy-Connections: keep" +
            "-alive\r\nConnections: keep-alive\r\nVia: " +
            `localhost:${proxy.address().port}\r\n\r\n`,
        );
      });

      serverSocket.on("data", chunk => {
        clientSocket.write(chunk);
      });

      serverSocket.on("end", () => {
        clientSocket.destroy();
      });
    } else {
      serverSocket.write(chunk);
    }
  });

  clientSocket.on("end", () => {
    serverSocket.destroy();
  });
});

server.listen(0);

proxy.listen(0, () => {
  console.log("CLIENT: Making CONNECT request");

  const req = http.request({
    port: proxy.address().port,
    method: "CONNECT",
    path: `localhost:${server.address().port}`,
    headers: {
      "Proxy-Connections": "keep-alive",
    },
  });
  req.useChunkedEncodingByDefault = false; // for v0.6
  req.on("connect", () => {
    console.log("CLIENT: got CONNECT response");
    process.exit(0);
  });
  req.end();
});
