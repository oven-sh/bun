// General rejection timing, no child stdio involved: two I/O callbacks of one loop turn.
const net = require("node:net");
const fs = require("node:fs");
const server = net.createServer(s => { s.write("a"); setTimeout(() => s.end("b"), 50); }).listen(0, () => {
  const c = net.connect(server.address().port);
  let n = 0;
  c.on("data", () => {
    n++; fs.writeSync(2, "data " + n + "\n");
    if (n === 1) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); Promise.reject(new Error("boom")); }
  });
  c.on("end", () => fs.writeSync(2, "end\n"));
  c.on("close", () => { fs.writeSync(2, "close\n"); server.close(); });
});
