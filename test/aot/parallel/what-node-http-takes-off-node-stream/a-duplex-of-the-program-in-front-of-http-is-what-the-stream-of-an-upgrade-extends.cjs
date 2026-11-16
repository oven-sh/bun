// `bun run` makes the stream that 'upgrade' gets, while the body of its request is incomplete, extend what lies under `Duplex` on node:stream when node:http is loaded. An executable takes the class from there too: a response that has no socket makes none, so node:http compiles no class in that stands on a Duplex of Bun's own.
"use strict";
const stream = require("node:stream");
const Was = stream.Duplex;
class Mine extends Was {}
stream.Duplex = Mine;
const http = require("node:http");
const net = require("node:net");
const server = http.createServer();
server.on("upgrade", (request, socket) => {
  console.log(socket instanceof Mine, socket instanceof net.Socket, new http.ServerResponse(request).socket);
  socket.destroy();
  server.close();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  client.on("error", () => {});
  client.write("GET / HTTP/1.1\r\nHost: made-up\r\nConnection: Upgrade\r\nUpgrade: made-up\r\nContent-Length: 5\r\n\r\nhe");
});
