// Prints what a server's response holds under three of the symbols of node:http while headers are set and a body is sent, what its
// public methods say at the same moments, and the symbols on the prototype of the server's socket.
const http = require("node:http");

const lines = [];
const under = (object, description) => object[Object.getOwnPropertySymbols(object).find(symbol => symbol.description === description)];
function say(label, res) {
  const headers = under(res, "kOutHeaders");
  lines.push(`${label}: kOutHeaders ${JSON.stringify(headers)}, kLenientValidation ${under(res, "kLenientValidation")}`);
  lines.push(`${label}: getHeaders() ${JSON.stringify(res.getHeaders())}, getRawHeaderNames() ${JSON.stringify(res.getRawHeaderNames())}`);
}

const server = http.createServer((req, res) => {
  const at = req.url;
  say(`${at} at the start`, res);
  res.on("finish", () => {
    lines.push(`${at} at finish: fakeSocket ${under(res, "fakeSocket") === null ? "null" : "a socket"}, res.socket ${res.socket === null ? "null" : "a socket"}`);
  });
  if (at === "/headers") {
    res.setHeader("X-One", "1");
    say(`${at} after setHeader`, res);
    res.setHeader("X-Two", ["a", "b"]);
    say(`${at} after a list`, res);
    res.removeHeader("x-one");
    say(`${at} after removeHeader`, res);
    res.end("ok");
  } else if (at === "/many") {
    for (let i = 0; i < 20; i++) res.setHeader(`x-${i}`, `${i}`);
    lines.push(`${at}: kOutHeaders has ${Object.keys(under(res, "kOutHeaders") ?? {}).length} entries, getHeaderNames() ${res.getHeaderNames().length}`);
    res.end("ok");
  } else {
    res.setHeader("content-length", 2);
    res.write("ok");
    res.end();
  }
});
server.on("connection", socket => {
  const symbols = Object.getOwnPropertySymbols(Object.getPrototypeOf(socket)).map(symbol => symbol.description);
  lines.push(`the prototype of a socket: ${symbols.join(" ")}`);
});
server.listen(0, "127.0.0.1", async () => {
  for (const path of ["/headers", "/many", "/length"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    lines.push(`${path}: ${response.status} ${await response.text()} ${response.headers.get("x-two")}`);
  }
  setTimeout(() => server.close(() => console.log(lines.join("\n"))), 20);
});
