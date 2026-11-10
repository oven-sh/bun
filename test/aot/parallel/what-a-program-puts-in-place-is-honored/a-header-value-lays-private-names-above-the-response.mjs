// While the head of a response is rendered, the toString() of a header's value lays two private names of a response on the prototype of responses. The status and the framing that the client gets are as without compilation. One case a process: behind such a store no short road is taken again.
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
