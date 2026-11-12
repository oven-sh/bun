// The same onto an object that a class of the program has made.
import http from "node:http";

class Kind { first = 1; }
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  const twin = Object.defineProperties(new Kind(), Object.getOwnPropertyDescriptors(res));
  const headers = Object.getOwnPropertySymbols(twin).find(symbol => symbol.description === "kOutHeaders");
  console.log(req.url, twin.first, JSON.stringify(twin[headers]));
  res.end("b");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
console.log(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text());
server.close();
