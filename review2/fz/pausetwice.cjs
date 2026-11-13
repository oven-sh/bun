// No 'uncaughtException' handler. The listener pauses the stream for 150 ms at the first chunk.
// Two more chunks arrive meanwhile (the child stays alive). After resume() every call of the listener throws.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "s:30", "oB:3", "s:30", "oC:3", "s:30", "oD:3", "s:400", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", d => {
  console.log("data", ++n, String(d));
  if (n === 1) { c.stdout.pause(); setTimeout(() => c.stdout.resume(), 150); return; }
  throw new Error("boom " + n);
});
c.stdout.on("end", () => console.log("end"));
c.on("exit", code => console.log("child exit", code));
c.on("close", code => { console.log("child close", code); process.exit(code); });
