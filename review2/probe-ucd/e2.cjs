// net.Socket, no 'uncaughtException' handler: is the listener called again after a fatal report?
const net = require("node:net");
const fs = require("node:fs");
const mode = process.argv[2]; // sync | tick | micro
const boom = () => { throw new Error("boom"); };
const server = net.createServer(s => { s.write(Buffer.alloc(1024, 97)); setTimeout(() => s.end(Buffer.alloc(4 * 1024 * 1024, 98)), 50); }).listen(0, () => {
  const c = net.connect(server.address().port);
  let n = 0;
  c.on("data", () => {
    n++; if (n <= 3) fs.writeSync(2, "data " + n + "\n");
    if (n === 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      if (mode === "sync") boom();
      if (mode === "tick") process.nextTick(boom);
      if (mode === "micro") queueMicrotask(boom);
    }
  });
  c.on("end", () => fs.writeSync(2, "end\n"));
  c.on("close", () => { fs.writeSync(2, "close\n"); server.close(); });
  process.on("exit", () => fs.writeSync(2, "calls=" + n + "\n"));
});
