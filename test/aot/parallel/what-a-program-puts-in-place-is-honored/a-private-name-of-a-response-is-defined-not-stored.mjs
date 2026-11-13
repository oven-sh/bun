// A value comes under a private name of a response by seven roads: a store, Reflect.set, Object.defineProperty with a written descriptor and with one that is a value, defineProperties, Object.assign, a key that is proven a symbol. The status that the client gets is as without compilation.
import http from "node:http";
let names = null,
  way = "";
const server = http.createServer((req, res) => {
  if (names === null) {
    res.writeHead(200);
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("first");
  }
  const symbol = names.kSnapshotStatusCode;
  if (way === "a store") res[symbol] = 503;
  else if (way === "Reflect.set") Reflect.set(res, symbol, 503);
  else if (way === "assign") Object.assign(res, { [symbol]: 503 });
  else if (way === "a key proven a symbol") {
    if (typeof symbol === "symbol")
      Object.defineProperty(res, symbol, { value: 503, writable: true, enumerable: true, configurable: true });
  } else if (way === "any key")
    Object.defineProperty(res, symbol, { value: 503, writable: true, enumerable: true, configurable: true });
  else if (way === "Reflect.defineProperty")
    Reflect.defineProperty(res, symbol, { value: 503, writable: true, enumerable: true, configurable: true });
  else Object.defineProperties(res, { [symbol]: { value: 503, writable: true, enumerable: true, configurable: true } });
  res.end("body");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
for (way of [
  "a store",
  "Reflect.set",
  "assign",
  "a key proven a symbol",
  "any key",
  "Reflect.defineProperty",
  "defineProperties",
]) {
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const got = await fetch(url);
    await got.text();
    seen.push(got.status);
  }
  console.log(way + ": " + seen.join(" "));
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
