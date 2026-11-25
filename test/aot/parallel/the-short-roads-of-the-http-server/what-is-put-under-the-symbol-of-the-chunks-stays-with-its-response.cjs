// The same with the list of chunks that wait for uncork(): what a program puts into the list of one response is not in the list of the next.
const http = require("node:http");
const net = require("node:net");
const lists = [];
const server = http.createServer((req, res) => {
  const key = Object.getOwnPropertySymbols(res).find((symbol) => symbol.description === "kChunkedBuffer");
  const list = res[key];
  lists.push(list);
  const before = list.length;
  list.length = 0;
  list.push(req.url);
  console.log(req.url, Array.isArray(list), before, list.length);
  list.length = 0;
  list.push(req.url, req.url);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/a", "/b", "/c"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("data", () => {
    if (asks.length) return ask();
    console.log("one list:", lists[0] === lists[1] || lists[1] === lists[2], lists.map((list) => list.join(",")).join(" | "));
    client.destroy();
    server.close();
  });
  ask();
});
