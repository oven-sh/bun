// A program stores a value under a private name of a response, which it finds among the own keys of an earlier one: the status that was taken, its message, the framing, the bytes that are held. No accessor is laid. What the client gets and what the response says are as without compilation.
import http from "node:http";
let names = null,
  way = "",
  seen = "",
  line = [];
const trace = (res, symbol) => {
  let value = res[symbol];
  Object.defineProperty(res, symbol, {
    configurable: true,
    enumerable: true,
    get() {
      line.push("get");
      return value;
    },
    set(next) {
      line.push("set " + next);
      value = next;
    },
  });
};
const listener = (req, res) => {
  if (names === null) {
    res.setHeader("connection", "close");
    res.writeHead(200);
    res.write("fir");
    names = {};
    for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
    return res.end("st");
  }
  if (way === "the status") res[names.kSnapshotStatusCode] = 503;
  else if (way === "the message") res[names.kSnapshotStatusMessage] = "Made Up";
  else if (way === "the framing") res[names.kFramingFrozenChunked] = true;
  else if (way === "the bytes") {
    res[names.kBytesBuffered] = 5;
    seen = String(res.writableLength);
  } else {
    res.setHeader("connection", "close");
    res.writeHead(200);
    trace(res, names.kMustCloseConnection);
    res.flushHeaders();
    seen = line.join(" . ");
  }
  res.end("body");
};
for (const [kind, options] of [
  ["its own class", {}],
  ["an heir's class", { ServerResponse: class extends http.ServerResponse {} }],
]) {
  const server = http.createServer(options, listener);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  names = null;
  await (await fetch(url)).text();
  for (way of ["the status", "the message", "the framing", "the bytes", "the read back"]) {
    seen = "";
    line = [];
    const got = await fetch(url),
      body = await got.text();
    console.log(
      kind +
        " . " +
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
        seen +
        " | " +
        body,
    );
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
