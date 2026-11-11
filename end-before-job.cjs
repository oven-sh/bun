// A child writes BYTES and exits while the parent is busy, so the bytes and the EOF are in the pipe before the
// parent's first read. The async 'data' listener finishes its work after one `await null`.
const cp = require("node:child_process");
const BYTES = +(process.env.BYTES || 150000), N = +(process.env.N || 10);
const sleeper = new Int32Array(new SharedArrayBuffer(4));
let bad = 0, n = 0, closeBad = 0;
function one() {
  const c = cp.spawn("/bin/sh", ["-c", `head -c ${BYTES} /dev/zero`], { stdio: ["ignore", "pipe", "ignore"] });
  Atomics.wait(sleeper, 0, 0, 120);   // the parent is busy: the child writes and exits meanwhile
  let got = 0, sent = 0;
  c.stdout.on("data", async d => { sent += d.length; await null; got += d.length; });
  c.stdout.on("end", () => { if (got !== sent) bad++; });
  c.stdout.on("close", () => {
    if (got !== sent) closeBad++;
    if (++n < N) one();
    else console.log(`BYTES=${BYTES}: 'end' before the listener's continuation: ${bad} of ${N}; 'close' before it: ${closeBad} of ${N}`);
  });
}
one();
