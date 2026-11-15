const http = require("node:http");
const said = [];
function handle(req, res) {
  let gets = 0;
  res.on("finish", () => process.nextTick(() => {
    const table = req._events;
    Object.defineProperty(req, "_events", { configurable: true, get() { gets++; return table; }, set() {} });
  }));
  res.end("ok");
  setTimeout(() => said.push(gets), 20);
}
const server = http.createServer(handle);
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < JSON.parse("3"); i++) {
    await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
    await new Promise(done => setTimeout(done, 40));
  }
  console.log(`SAID ${said.join(" ")}`);
  server.closeAllConnections(); server.close();
});
