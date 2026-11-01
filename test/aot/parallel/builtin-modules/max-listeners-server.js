require("node:events").EventEmitter.prototype._maxListeners = Number(process.argv[2] ?? 100);
const http = require("node:http");
const server = http.createServer((req, res) => {
  console.log("request", req.getMaxListeners(), Object.hasOwn(req, "_maxListeners"));
  console.log("response", res.getMaxListeners(), Object.hasOwn(res, "_maxListeners"));
  res.end("ok");
});
server.listen(0, async () => {
  console.log(await (await fetch("http://localhost:" + server.address().port)).text(), server.getMaxListeners());
  server.close();
});
