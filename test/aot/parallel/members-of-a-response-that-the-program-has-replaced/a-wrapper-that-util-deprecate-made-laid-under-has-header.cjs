// util.deprecate() makes a function of the library's own around one of the program's, and the program lays it under hasHeader on the prototype of responses. writeHead() calls it, as without compilation.
// What the program's text lays on the nearer prototype is itself a function of the library: another method under the name, a method that util.deprecate() has wrapped, one that bind() has made.
const http = require("node:http");
const net = require("node:net");
const stream = require("node:stream");
const util = require("node:util");
const log = [];
process.noDeprecation = true;
http.ServerResponse.prototype.getHeader = http.OutgoingMessage.prototype.hasHeader;
http.ServerResponse.prototype.hasHeader = util.deprecate(
  function (name) {
    log.push(`hasHeader ${name}`);
    return http.OutgoingMessage.prototype.hasHeader.call(this, name);
  },
  "made up",
  "MADE_UP",
);
net.Socket.prototype.removeListener = stream.Readable.prototype.on;
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  res.writeHead(200, { "Content-Type": "text/plain" });
  const counted = [];
  for (const chunk of ["a", "bb", "ccc"]) counted.push(`${res.write(chunk)} ${res.writableLength}`);
  log.push(`request ${requests}: ${counted.join(", ")} . close listeners ${req.socket.listenerCount("close")}`);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("connect", ask);
  client.on("data", bytes => {
    if (!String(bytes).endsWith("0\r\n\r\n")) return;
    setImmediate(() => {
      if (++answers < 4) return void ask();
      client.destroy();
      server.close();
      console.log(log.join("\n"));
    });
  });
});
