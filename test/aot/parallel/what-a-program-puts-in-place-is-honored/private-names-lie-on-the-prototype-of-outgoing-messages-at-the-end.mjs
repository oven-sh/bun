// Two private names of a response lie on the prototype of outgoing messages when end() is called.
import http from "node:http";
let names = null;
const above = http.OutgoingMessage.prototype;
const server = http.createServer((req, res) => {
  if (names === null) {
    res.writeHead(200);
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("first");
  }
  res.setHeader("x-made-up", "1");
  above[names.kFramingFrozenChunked] = true;
  above[names.kSnapshotStatusCode] = 503;
  res.end("body");
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
