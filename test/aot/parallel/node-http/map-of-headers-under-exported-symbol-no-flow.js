// node:_http_outgoing exports the symbol of the map of headers: a program has it without listing any keys. Built without whole-program analysis.
// Flags: --aot-disable=flow-results
const http = require("node:http");
const { kOutHeaders } = require("node:_http_outgoing");
const lines = [];
function read(res) {
  return res[kOutHeaders];
}
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  if (req.url === "/direct") lines.push("direct: " + JSON.stringify(res[kOutHeaders]));
  else if (req.url === "/function") lines.push("function: " + JSON.stringify(read(res)));
  else if (req.url === "/has")
    lines.push(
      "has: " + (kOutHeaders in res) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(res, kOutHeaders)),
    );
  else if (req.url === "/store") {
    res[kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] };
    lines.push("store: " + JSON.stringify(res.getHeaders()));
  } else if (req.url === "/pattern") {
    const { [kOutHeaders]: map } = res;
    lines.push("pattern: " + JSON.stringify(map));
  }
  res.end("ok");
});
server.listen(0, async () => {
  for (const path of ["/direct", "/function", "/has", "/store", "/pattern"]) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + path);
    lines.push(
      path + " " + response.headers.get("x-one") + " " + response.headers.get("x-two") + " " + (await response.text()),
    );
  }
  console.log(lines.join("\n"));
  server.close();
});
