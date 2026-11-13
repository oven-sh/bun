// Same residual on a plain TCP net.Socket: 'data' and FIN arrive in one wakeup, the 'data' listener throws with no handler.
const net = require("node:net");
const server = net.createServer(s => { s.end("hi"); });
server.listen(0, "127.0.0.1", () => {
  const c = net.connect({ port: server.address().port, host: "127.0.0.1" });
  c.on("connect", () => {
    server.close();
    // Block this turn so data and FIN are both queued before the client's next read.
    const nap = new Int32Array(new SharedArrayBuffer(4)); Atomics.wait(nap, 0, 0, 100);
  });
  c.on("data", () => { console.log("data"); throw new Error("data-throw-fatal"); });
  c.on("end", () => console.log("end"));
  c.on("close", () => { console.log("close"); process.exit(0); });
});
