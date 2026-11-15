// A pipelined response that waits behind another has no socket, as in Node: it reads null until the connection is its own, 'socket' tells it so, and the two answers leave in the order of their requests.
const http = require("node:http"), net = require("node:net");
const out = [];
const show = (res, socket) => (res.socket === socket ? "the connection" : String(res.socket));
let first;
const server = http.createServer((req, res) => {
  if (req.url === "/1") {
    first = res;
    return void out.push("first " + show(res, req.socket));
  }
  out.push("second waits " + show(res, req.socket));
  res.on("socket", socket => out.push("second 'socket' " + (socket === req.socket) + " " + show(res, req.socket)));
  res.on("finish", () => out.push("second finish " + show(res, req.socket)));
  res.end("two");
  out.push("second ended " + show(res, req.socket));
  first.end("one");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let heard = "";
  client.on("data", chunk => {
    heard += chunk;
    if (!heard.includes("two")) return;
    out.push("order " + (heard.indexOf("one") < heard.indexOf("two")));
    console.log(out.join("\n"));
    client.destroy();
    server.close();
  });
  client.write("GET /1 HTTP/1.1\r\nHost: a\r\n\r\nGET /2 HTTP/1.1\r\nHost: a\r\n\r\n");
});
