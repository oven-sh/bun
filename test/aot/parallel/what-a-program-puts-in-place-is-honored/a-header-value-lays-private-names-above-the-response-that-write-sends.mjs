// As a-header-value-lays-private-names-above-the-response.mjs, with the head sent by write().
import http from "node:http";
let names = null,
  armed = false;
const above = http.ServerResponse.prototype;
const server = http.createServer((req, res) => {
  if (names === null) {
    res.writeHead(200);
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("first");
  }
  res.setHeader("x-made-up", {
    toString() {
      if (armed) {
        armed = false;
        above[names.kFramingFrozenChunked] = true;
        above[names.kSnapshotStatusCode] = 503;
      }
      return "1";
    },
  });
  armed = true;
  res.write("bo");
  res.end("dy");
  delete above[names.kFramingFrozenChunked];
  delete above[names.kSnapshotStatusCode];
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
const got = await fetch(url),
  body = await got.text();
console.log(
  got.status +
    " " +
    got.statusText +
    " | " +
    got.headers.get("content-length") +
    " " +
    got.headers.get("transfer-encoding") +
    " | " +
    body,
);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
