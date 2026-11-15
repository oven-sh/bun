// The road of internal:http1_server_fallback: `server.emit("connection", socket)` over a socket of node:net. As in Node, a response has its connection until 'finish', and a pipelined response that waits behind another has none until the connection is its own.
const http = require("node:http"), net = require("node:net");
const out = [];
const show = (res, socket) => (res.socket === socket && res.connection === socket ? "the connection" : String(res.socket));
let first;
const server = http.createServer((req, res) => {
  const socket = req.socket, at = name => () => out.push(req.url + " " + name + " " + show(res, socket));
  at("listener")();
  res.on("socket", at("'socket'"));
  res.on("finish", at("finish"));
  res.on("close", () => {
    at("close")();
    if (req.url !== "/2") return;
    console.log(out.join("\n"));
    client.destroy();
    tcp.close();
  });
  if (req.url === "/1") return void (first = res);
  process.nextTick(at("tick in front of end()"));
  res.write("a", at("callback of write()"));
  res.end("two");
  at("behind end()")();
  first.end("one");
});
const tcp = net.createServer(socket => server.emit("connection", socket));
let client;
tcp.listen(0, "127.0.0.1", () => {
  client = net.connect(tcp.address().port, "127.0.0.1");
  client.on("error", () => {});
  client.resume();
  client.write("GET /1 HTTP/1.1\r\nHost: a\r\n\r\nGET /2 HTTP/1.1\r\nHost: a\r\n\r\n");
});
