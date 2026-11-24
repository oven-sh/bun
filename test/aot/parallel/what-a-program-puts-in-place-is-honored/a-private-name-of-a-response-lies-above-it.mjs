// A private name of a response lies on an object above it: one of the program's own that is linked in between, with the name stored in front of the link or behind it, or the prototype of responses while a response is under way. The status and the framing that the client gets are as without compilation.
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
  if (way === "the prototype, under way") http.ServerResponse.prototype[names.kFramingFrozenChunked] = true;
  else {
    const holder = {};
    if (way === "the framing") holder[names.kFramingFrozenChunked] = true;
    if (way === "the status") holder[names.kSnapshotStatusCode] = 503;
    Object.setPrototypeOf(holder, http.ServerResponse.prototype);
    Object.setPrototypeOf(res, holder);
    if (way === "the framing, stored behind the link") holder[names.kFramingFrozenChunked] = true;
    if (way === "the status, stored behind the link") holder[names.kSnapshotStatusCode] = 503;
  }
  res.end("body");
  if (way === "the prototype, under way") delete http.ServerResponse.prototype[names.kFramingFrozenChunked];
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
for (way of [
  "nothing",
  "the framing",
  "the framing",
  "the status",
  "the framing, stored behind the link",
  "the status, stored behind the link",
  "the prototype, under way",
]) {
  const got = await fetch(url),
    body = await got.text();
  console.log(
    way +
      ": " +
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
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
