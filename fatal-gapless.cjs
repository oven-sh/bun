// No uncaughtException handler. A gapless 4 MB writer; the listener throws on every call.
const { spawn } = require("node:child_process");
const c = spawn(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(4*1024*1024, 97))"], { stdio: ["ignore", "pipe", "ignore"] });
let n = 0;
c.stdout.on("data", () => { n++; throw new Error("boom"); });
process.on("exit", code => console.log("exit code", code, "listener calls", n));
