// COUNT: operation:operationAOTInByValGeneric <= 600
// COUNT: operation:operationAOTHasOwnByValAndCache <= 600
// Before it reads the state of a socket past the accessors of Readable.prototype and Duplex.prototype, the server asks whether the socket has `readableLength`, `destroyed` .. for itself: eight times a request.
// The names are fields of the socket whose slots are empty, so a read under one is filed as "the slot, else the getter above", and Object.hasOwn() could not tell from that:
// with 64 connections it came to the run time 4.4 times a request, 900 instructions each. 3,200 requests on 32 connections.
const http = require("node:http");
const net = require("node:net");
const requests = 3200;
const connections = 32;
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/plain");
  response.end("Hello World");
});
server.listen(0, "127.0.0.1", () => {
  let open = connections;
  let answers = 0;
  for (let index = 0; index < connections; index++) {
    const socket = net.connect(server.address().port, "127.0.0.1");
    let left = requests / connections;
    const ask = () => socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    socket.on("connect", ask);
    socket.on("data", chunk => {
      if (!chunk.toString("latin1").endsWith("Hello World")) return;
      answers++;
      if (--left > 0) return ask();
      socket.destroy();
      if (--open) return;
      console.log(answers, "answers");
      server.close();
    });
  }
});
