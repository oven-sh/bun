// No 'uncaughtException' handler. The child writes one chunk and exits at once (a grandchild keeps the pipe open,
// so no EOF is involved). The listener throws. A wrapper forwards the child's exit code from 'exit'.
const { spawn } = require("node:child_process");
const c = spawn("/tmp/fz/w", ["s:40", "oA:3", "f", "s:300", "x:0"], { stdio: ["ignore", "pipe", "ignore"] });
c.stdout.on("data", () => { console.log("data"); throw new Error("boom"); });
c.on("exit", code => { console.log("child exit", code); process.exit(code); });
