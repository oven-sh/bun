// The program lays methods of its own on prototypes that stand between two classes of the library, serves, and takes them away again: each is called as often as without compilation, before and behind.
import http from "node:http";
import net from "node:net";
import stream from "node:stream";
const log = [];
let isServing = false;
stream.Duplex.prototype.removeListener = function (name, listener) {
  if (isServing) log.push(`a duplex removes ${String(name)}`);
  return stream.Readable.prototype.removeListener.call(this, name, listener);
};
stream.Duplex.prototype.resume = function () {
  if (isServing) log.push("a duplex resumes");
  return stream.Readable.prototype.resume.call(this);
};
stream.Stream.prototype.on = function (name, listener) {
  if (isServing && this instanceof http.OutgoingMessage) log.push(`a response listens to ${String(name)}`);
  return Object.getPrototypeOf(stream.Stream.prototype).on.call(this, name, listener);
};
stream.Stream.prototype.emit = function (name, ...values) {
  if (isServing && this instanceof http.OutgoingMessage) log.push(`a response emits ${String(name)}`);
  return Object.getPrototypeOf(stream.Stream.prototype).emit.call(this, name, ...values);
};
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  log.push(`request ${requests}`);
  res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": 2 });
  res.end("ok");
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
    if (!String(bytes).endsWith("ok")) return;
    setImmediate(() => {
      isServing = false;
      if (++answers === 3) {
        delete stream.Duplex.prototype.removeListener;
        delete stream.Duplex.prototype.resume;
        delete stream.Stream.prototype.on;
        delete stream.Stream.prototype.emit;
        log.push("taken away");
      }
      if (answers < 5) return void ask();
      client.destroy();
      server.close();
      console.log(log.join("\n"));
    });
  });
});
