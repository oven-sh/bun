// No 'uncaughtException' handler. The child writes three chunks 30 ms apart and stays alive for a while.
// The 'data' listener is attached after 150 ms (as after an await) and throws on every call.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "s:30", "oB:3", "s:30", "oC:3", "s:400", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
setTimeout(() => {
  c.stdout.on("data", d => { console.log("data", ++n, String(d)); throw new Error("boom " + n); });
}, 150);
c.stdout.on("end", () => console.log("end"));
c.on("exit", code => console.log("child exit", code));
c.on("close", code => { console.log("child close", code); process.exit(code); });
