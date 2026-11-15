// Node keeps `socket` on OutgoingMessage.prototype alone, so a program may lay an accessor of its own under the name on ServerResponse.prototype. Every store of the library goes through it: the connection when a response gets it, null at 'finish'.
const http = require("node:http"), net = require("node:net");
const held = new WeakMap(), out = [];
Object.defineProperty(http.ServerResponse.prototype, "socket", {
  configurable: true,
  get() {
    return held.has(this) ? held.get(this) : null;
  },
  set(value) {
    out.push("stored " + (value === null ? "null" : typeof value));
    held.set(this, value);
  },
});
const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
let closed = 0, client;
const server = http.createServer((req, res) => {
  out.push("listener " + (res.socket === req.socket) + " " + (res.connection === req.socket));
  process.nextTick(() => out.push("tick " + (res.socket === req.socket)));
  res.on("finish", () => out.push("finish " + res.socket + " " + res.connection));
  res.on("close", () => {
    out.push("close " + res.socket);
    if (++closed < 2) return void client.write(GET);
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
