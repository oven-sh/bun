// The program lays methods of its own on a prototype that stands nearer to the object than the one that the library laid them on: each is called as often as without compilation.
import http from "node:http";
import net from "node:net";
import stream from "node:stream";
const log = [];
let isServing = false;
http.ServerResponse.prototype.hasHeader = function (name) {
  log.push(`hasHeader ${name}`);
  return http.OutgoingMessage.prototype.hasHeader.call(this, name);
};
http.ServerResponse.prototype.getHeader = function (name) {
  log.push(`getHeader ${name}`);
  return http.OutgoingMessage.prototype.getHeader.call(this, name);
};
http.ServerResponse.prototype.on = function (name, listener) {
  log.push(`on ${String(name)}`);
  return stream.Stream.prototype.on.call(this, name, listener);
};
http.Server.prototype.emit = function (name, ...values) {
  if (isServing) log.push(`the server emits ${String(name)}`);
  return net.Server.prototype.emit.call(this, name, ...values);
};
net.Socket.prototype.removeListener = function (name, listener) {
  if (isServing) log.push(`a socket removes ${String(name)}`);
  return stream.Duplex.prototype.removeListener.call(this, name, listener);
};
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  log.push(`request ${requests}`);
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
  const ask = () => {
    isServing = true;
    client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  };
  let answers = 0;
  client.on("connect", ask);
  client.on("data", (bytes) => {
    const text = String(bytes);
    if (!text.endsWith("ok") && !text.endsWith("0\r\n\r\n")) return;
    setImmediate(() => {
      isServing = false;
      if (++answers < 4) return void ask();
      client.destroy();
      server.close();
      console.log(log.join("\n"));
    });
  });
});
