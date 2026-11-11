const http = require("node:http");
const held = new WeakMap(),
  seen = new Set();
Object.defineProperty(http.OutgoingMessage.prototype, "_eventsCount", {
  configurable: true,
  get() {
    return held.get(this);
  },
  set(value) {
    seen.add(this);
    held.set(this, value);
  },
});
class Mine extends http.IncomingMessage {}
const server = http.createServer({ IncomingMessage: Mine }, (req, res) => {
  console.log(`SAID ${seen.size} ${seen.has(res)}`);
  res.end("ok");
});
server.listen(0, "127.0.0.1", async () => {
  await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
  server.closeAllConnections();
  server.close();
});
