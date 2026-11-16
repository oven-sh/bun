// An accessor under _construct above all requests is read where Readable's constructor reads it: behind the stores of the request's own constructor.
const http = require("node:http");
const net = require("node:net");

const above = http.IncomingMessage.prototype;
let log = [];
const said = [];
for (const name of ["url", "method", "complete"]) {
  let held;
  Object.defineProperty(above, name, { configurable: true, get() { return held; }, set(value) { held = value; log.push(name); } });
}
Object.defineProperty(above, "_construct", { configurable: true, get() { log.push("_construct"); return undefined; } });

const server = http.createServer((req, res) => {
  said.push(log.join(","));
  log = [];
  res.end("x");
});
server.listen(0, "127.0.0.1", () => {
  const socket = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  socket.on("data", () => {
    if (++answers === 3) {
      console.log(said.join("\n"));
      socket.destroy();
      server.close();
      server.closeAllConnections();
    } else socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
  socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
});
