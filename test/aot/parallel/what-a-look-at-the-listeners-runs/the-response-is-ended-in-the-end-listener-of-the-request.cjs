const http = require("node:http");
const seen = [];
let count = 0;
const server = http.createServer((req, res) => {
  const side = {}, lays = count++ % 2 === 1;
  let looks = 0;
  Object.defineProperty(req._events, "close", {
    configurable: true,
    enumerable: true,
    get() { looks++; if (lays) req._writableState = side; return undefined; },
  });
  req.on("end", () => res.end("ok"));
  req.resume();
  setTimeout(() => seen.push(`${looks}:${Object.getOwnPropertySymbols(side).length}`), 20);
});
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < JSON.parse("4"); i++) {
    await (await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: "body" })).text();
    await new Promise(done => setTimeout(done, 40));
  }
  console.log(`SAID ${seen.join(" ")}`);
  server.closeAllConnections(); server.close();
});
