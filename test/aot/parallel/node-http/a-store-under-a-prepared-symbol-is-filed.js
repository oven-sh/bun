// COUNT: operation:operationAOTPutByIdAndCache <= 700
// The library lays the socket on each response under a symbol of its own, by name: `res[fakeSocketSymbol] = socket`. The symbol has a preparation, so what is found under it is filed for accesses by name alone:
// in a cell in front of the hashed table. Such a cell has no room for the addition of a property, and the hashed table refused the name, so the store was filed nowhere and came to the run time at every request:
// 6,000 of the 60,000 instructions of a request. 2,000 requests on one connection: the run counts how often a store by name has missed.
const http = require("node:http");
const net = require("node:net");
const requests = 2000;
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/plain");
  response.end("Hello World");
});
server.listen(0, "127.0.0.1", () => {
  const socket = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  let bytes = 0;
  const ask = () => socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
  socket.on("connect", ask);
  socket.on("data", chunk => {
    bytes += chunk.length;
    if (!chunk.toString("latin1").endsWith("Hello World")) return;
    if (++answers < requests) return ask();
    console.log(answers, "answers", bytes > requests * 100);
    socket.destroy();
    server.close();
  });
});
