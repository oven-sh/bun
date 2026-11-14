// The lists are reached by what walks over all own properties: descriptors, a copy by spread, Object.assign, Reflect.get.
const http = require("node:http");
const net = require("node:net");
const ways = {
  "/descriptors": (res, key) => Object.getOwnPropertyDescriptors(res)[key].value,
  "/descriptor": (res, key) => Object.getOwnPropertyDescriptor(res, key).value,
  "/spread": (res, key) => ({ ...res })[key],
  "/assign": (res, key) => Object.assign({}, res)[key],
  "/reflect": (res, key) => Reflect.get(res, key),
};
const lists = [];
const server = http.createServer((req, res) => {
  const key = Reflect.ownKeys(res).find((name) => typeof name === "symbol" && name.description === "pendingCallbacks");
  const list = ways[req.url](res, key);
  lists.push(list);
  list.push(() => console.log("called for", req.url));
  console.log(req.url, list.length);
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/descriptors", "/descriptor", "/spread", "/assign", "/reflect"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("data", () => {
    if (asks.length) return ask();
    console.log("lists:", new Set(lists).size);
    client.destroy();
    server.close();
  });
  ask();
});
