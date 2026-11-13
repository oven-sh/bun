// A response is born by plain stores only while no program has laid an accessor above it, also one that the build has seen.
const http = require("node:http"), net = require("node:net");
const held = new WeakMap();
const log = [];
const answers = [];
const server = http.createServer((request, response) => {
  answers.push(log.splice(0).join() + "|" + response.listenerCount("finish") + "|" + response._eventsCount);
  log.length = 0;
  response.end("x");
});
const ask = () =>
  new Promise(done => {
    const socket = net.connect(server.address().port, "127.0.0.1");
    socket.on("data", () => { socket.destroy(); setTimeout(done, 5); });
    socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
process.on("uncaughtException", error => { console.log("uncaught", error.constructor.name); process.exit(0); });
server.listen(0, "127.0.0.1", async () => {
  await ask();
  Object.defineProperty(http.OutgoingMessage.prototype, "_eventsCount", { configurable: true, get() { log.push("get"); return held.get(this); }, set(v) { log.push("=" + v); held.set(this, v); } });
  await ask();
  await ask();
  delete http.OutgoingMessage.prototype._eventsCount;
  await ask();
  Object.defineProperty(http.ServerResponse.prototype, "_eventsCount", { configurable: true, get() { log.push("get below"); return held.get(this); }, set(v) { log.push("below=" + v); held.set(this, v); } });
  await ask();
  delete http.ServerResponse.prototype._eventsCount;
  await ask();
  console.log(answers.join("\n"));
  process.exit(0);
});
