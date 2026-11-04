// A response that has let go of its socket makes one when it accounts for what was written. The short road asks for none, and whoever looks under the symbol finds what the long road would have left there,
// whether or not the build has given the name a slot.
const http = require("node:http");
const show = found => (found === null ? "null" : typeof found + " " + (found && found.constructor.name));
const server = http.createServer((req, res) => {
  const key = Object.getOwnPropertySymbols(res).find(symbol => symbol.description === "fakeSocket");
  const first = req.url.includes("look") ? show(res[key]) : "not looked at";
  res.on("finish", () => console.log(req.url, first, "| at finish:", show(res[key])));
  res.setHeader("content-length", 2);
  if (req.url.includes("write")) { res.write("o"); res.end("k"); } else res.end("ok");
});
server.listen(0, async () => {
  for (const path of ["/first", "/look", "/write", "/look-write", "/look-write"]) await (await fetch("http://127.0.0.1:" + server.address().port + path)).text();
  server.close();
});
