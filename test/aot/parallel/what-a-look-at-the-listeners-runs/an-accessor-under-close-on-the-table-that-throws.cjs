const http = require("node:http");
const said = [];
process.on("uncaughtException", error => said.push(`uncaught: ${error.message}`));
function handle(req, res) {
  Object.defineProperty(req._events, "close", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("made up");
    },
    set() {},
  });
  try {
    res.end("ok");
    said.push("ended");
  } catch (error) {
    said.push(`end() threw: ${error.message}`);
  }
}
const server = http.createServer(handle);
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < JSON.parse("3"); i++) {
    await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
    await new Promise(done => setTimeout(done, 40));
  }
  console.log(`SAID ${[...new Set(said)].join(" | ")}`);
  server.closeAllConnections();
  server.close();
});
