// A response has its connection until 'finish', as in Node. A tick that the listener queued in front of end() and the callback of a write read the connection, destroy() in such a tick closes it, and from 'finish' on the response has none.
const http = require("node:http"), net = require("node:net");
const out = [];
const show = (res, socket) => (res.socket === socket && res.connection === socket ? "the connection" : String(res.socket));
const GET = path => `GET ${path} HTTP/1.1\r\nHost: a\r\n\r\n`;
const paths = ["/end", "/write", "/later", "/destroy"];
let client;
const server = http.createServer((req, res) => {
  const socket = req.socket, at = name => () => out.push(req.url + " " + name + " " + show(res, socket));
  process.nextTick(at("tick in front of end()"));
  res.on("finish", at("finish"));
  res.on("close", () => {
    at("close")();
    const next = paths[paths.indexOf(req.url) + 1];
    if (next !== undefined && next !== "/destroy") return void client.write(GET(next));
    if (next === "/destroy") return void connect("/destroy");
    console.log(out.join("\n"));
    server.close();
  });
  if (req.url === "/write") res.write("a", at("callback of write()"));
  if (req.url === "/later") return void setImmediate(() => (at("in front of end()")(), res.end("x"), at("behind end()")()));
  if (req.url === "/destroy") process.nextTick(() => (res.destroy(), out.push("/destroy destroyed " + socket.destroyed)));
  res.end("x");
  at("behind end()")();
});
function connect(path) {
  client = net.connect(server.address().port, "127.0.0.1");
  client.on("error", () => {});
  client.resume();
  client.write(GET(path));
}
server.listen(0, "127.0.0.1", () => connect(paths[0]));
