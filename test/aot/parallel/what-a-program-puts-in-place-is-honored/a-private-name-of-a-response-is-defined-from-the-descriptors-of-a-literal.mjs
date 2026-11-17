// A value comes under a private name of a response by Object.defineProperties() with the descriptors of a literal. The status that the client gets is as without compilation.
import http from "node:http";
let names = null;
const server = http.createServer((req, res) => {
  if (names === null) {
    res.writeHead(200);
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("first");
  }
  Object.defineProperties(res, Object.getOwnPropertyDescriptors({ [names.kSnapshotStatusCode]: 503 }));
  res.end("body");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
const seen = [];
for (let i = 0; i < 3; i++) {
  const got = await fetch(url);
  await got.text();
  seen.push(got.status);
}
console.log(seen.join(" "));
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
