// The child writes two chunks 40 ms apart and stays alive. A 'data' listener attached after 105 ms destroys the stream on its first call.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["oA:3", "s:40", "oB:3", "s:200", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
const log = s => require("fs").writeSync(1, s + "\n");
let n = 0;
setTimeout(() => c.stdout.on("data", d => { log("data " + ++n + " " + d); if (n === 1) c.stdout.destroy(); }), 105);
c.stdout.on("end", () => log("end")); c.stdout.on("close", () => log("close"));
