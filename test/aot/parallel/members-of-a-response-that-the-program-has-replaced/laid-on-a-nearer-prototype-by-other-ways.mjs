// The methods of the program come onto the nearer prototype through another name for it, under a key that is put together, by Object.assign and by Object.defineProperty, and one amid a request.
import http from "node:http";
import net from "node:net";
import stream from "node:stream";
const log = [];
let isServing = false;
const nearer = http.ServerResponse.prototype;
nearer["has" + "Header"] = function (name) {
  log.push(`hasHeader ${name}`);
  return http.OutgoingMessage.prototype.hasHeader.call(this, name);
};
Object.defineProperty(net.Socket.prototype, "removeListener", {
  value(name, listener) {
    if (isServing) log.push(`a socket removes ${String(name)}`);
    return stream.Duplex.prototype.removeListener.call(this, name, listener);
  },
  writable: true,
  configurable: true,
});
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  log.push(`request ${requests}`);
  if (requests === 3) {
    Object.assign(nearer, {
      getHeader(name) {
        log.push(`getHeader ${name}`);
        return http.OutgoingMessage.prototype.getHeader.call(this, name);
      },
    });
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.write("a");
  res.write("b");
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  const ask = () => {
    isServing = answers > 0;
    client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  };
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("0\r\n\r\n")) return;
    setImmediate(() => {
      isServing = false;
      if (++answers < 5) return void ask();
      client.destroy();
      server.close();
      console.log(log.join("\n"));
    });
  });
});
