// Listener attached at spawn; the child writes 3 MB without gaps; the listener throws on every chunk (handled).
const { spawn } = require("child_process");
const c = spawn("sh", ["-c", "head -c 3000000 /dev/zero"], { stdio: ["ignore", "pipe", "ignore"] });
let bytes = 0, calls = 0, u = 0, ur = 0, end = 0;
process.on("uncaughtException", () => u++);
process.on("unhandledRejection", () => ur++);
c.stdout.on("data", d => { calls++; bytes += d.length; throw new Error("boom"); });
c.stdout.on("end", () => end++);
let close = "never";
c.on("close", code => { close = code; });
setTimeout(() => { console.log(JSON.stringify({ bytes, calls, uncaughtException: u, unhandledRejection: ur, end, close })); process.exit(0); }, 2500);
