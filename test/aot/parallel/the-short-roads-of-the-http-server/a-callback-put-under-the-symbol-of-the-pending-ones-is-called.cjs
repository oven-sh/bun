// A program finds the list of pending callbacks among the keys of a response and puts one in: each response has a list of its own, and end() calls what is in it.
const http = require("node:http");
const net = require("node:net");
const lists = [];
const server = http.createServer((req, res) => {
  const key = Object.getOwnPropertySymbols(res).find((symbol) => symbol.description === "pendingCallbacks");
  const list = res[key];
  lists.push(list);
  list.push(() => console.log("called for", req.url));
  console.log(req.url, Array.isArray(list), list.length);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/a", "/b", "/c"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("data", () => {
    if (asks.length) return ask();
    console.log("one list:", lists[0] === lists[1] || lists[1] === lists[2]);
    client.destroy();
    server.close();
  });
  ask();
});
