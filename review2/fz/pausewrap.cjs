// No 'uncaughtException' handler. The listener pauses the stream for 100 ms at the first chunk (backpressure by hand).
// The child writes a second chunk and exits meanwhile. resume() hands the second chunk over, and the listener throws.
// A wrapper forwards the child's exit code from 'close'.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "s:30", "oB:3", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", d => {
  console.log("data", ++n, String(d));
  if (n === 1) { c.stdout.pause(); setTimeout(() => c.stdout.resume(), 100); return; }
  throw new Error("boom");
});
c.stdout.on("end", () => console.log("end"));
c.on("exit", code => console.log("child exit", code));
c.on("close", code => { console.log("child close", code); process.exit(code); });
