// No 'uncaughtException' handler. The stream is paused at spawn and resumed 150 ms later (a consumer that is not ready yet).
// The child writes three chunks 30 ms apart and stays alive. The 'data' listener throws on every call.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "s:30", "oB:3", "s:30", "oC:3", "s:400", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.pause();
c.stdout.on("data", d => { console.log("data", ++n, String(d)); throw new Error("boom " + n); });
setTimeout(() => c.stdout.resume(), 150);
c.stdout.on("end", () => console.log("end"));
c.on("close", code => { console.log("child close", code); process.exit(code); });
