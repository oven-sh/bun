// A value that a program lays under `socket` on ServerResponse.prototype hides the accessor of OutgoingMessage.prototype. A store of the library then makes a property of the response's own, and the slot behind the accessor stays empty.
const http = require("node:http"), net = require("node:net");
const out = [];
const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
const slot = response => Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, "socket").get.call(response);
let closed = 0, client;
const server = http.createServer((req, res) => {
  out.push("listener " + Object.hasOwn(res, "socket") + " " + (res.socket === req.socket) + " " + slot(res));
  process.nextTick(() => out.push("tick " + (res.socket === req.socket) + " " + slot(res)));
  res.on("finish", () => out.push("finish " + Object.hasOwn(res, "socket") + " " + res.socket + " " + slot(res)));
  res.on("close", () => {
    out.push("close " + res.socket);
    if (++closed === 1) {
      // The first response came before the value.
      Object.defineProperty(http.ServerResponse.prototype, "socket", { value: "laid", writable: true, enumerable: true, configurable: true });
      return void client.write(GET);
    }
    if (closed === 2) {
      delete http.ServerResponse.prototype.socket;
      return void client.write(GET);
    }
    console.log(out.join("\n"));
    client.destroy();
    server.close();
  });
  res.end("x");
});
server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1");
  client.resume();
  client.write(GET);
});
