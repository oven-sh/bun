// As express does it: each response gets a prototype of the program's that stands below ServerResponse.prototype. This one has accessors and methods under the names that the short roads ask for.
import http from "node:http";
import net from "node:net";
const log = [];
const below = Object.create(http.ServerResponse.prototype);
Object.defineProperty(below, "socket", {
  get() { log.push("get socket"); return Reflect.get(http.ServerResponse.prototype, "socket", this); },
  set(value) { log.push(`set socket ${value === null ? "null" : typeof value}`); Reflect.set(http.ServerResponse.prototype, "socket", value, this); },
});
Object.defineProperty(below, "headersSent", {
  get() { log.push("get headersSent"); return Reflect.get(http.ServerResponse.prototype, "headersSent", this); },
});
Object.defineProperty(below, "writableHighWaterMark", {
  get() { log.push("get writableHighWaterMark"); return Reflect.get(http.ServerResponse.prototype, "writableHighWaterMark", this); },
});
below.emit = function (name, ...values) {
  log.push(`emit ${String(name)}`);
  return http.ServerResponse.prototype.emit.call(this, name, ...values);
};
below.detachSocket = function (socket) {
  log.push("detachSocket");
  return http.ServerResponse.prototype.detachSocket.call(this, socket);
};
below.getHeader = function (name) {
  log.push(`getHeader ${name}`);
  return http.ServerResponse.prototype.getHeader.call(this, name);
};
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  log.push(`request ${requests}`);
  Object.setPrototypeOf(res, below);
  if (requests % 2 === 0) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("a");
    res.write("b");
    res.end();
  } else {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 });
    res.end("ok");
  }
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  let answers = 0;
  client.on("connect", ask);
  client.on("data", (bytes) => {
    const text = String(bytes);
    if (!text.endsWith("ok") && !text.endsWith("0\r\n\r\n")) return;
    if (++answers < 4) return void setImmediate(ask);
    client.destroy();
    server.close();
    setImmediate(() => console.log(log.join("\n")));
  });
});
