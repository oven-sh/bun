const http = require("http");
const { URL } = require("url");
const { makeCache, handle } = require("./shared.js");
const cache = makeCache();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const id = u.pathname.split("/")[2] ?? "0";
  const q = Object.fromEntries(u.searchParams);
  const body = JSON.stringify(handle(cache, id, q));
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
});
server.listen(0, () => {
  process.stderr.write(`LISTEN ${server.address().port}\n`);
});
