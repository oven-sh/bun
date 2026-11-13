// The common case: the child writes a little and exits at once, so the data and the EOF reach the parent together. No 'uncaughtException' handler.
const { spawn } = require("node:child_process");
const fd = +process.argv[2];
const c = spawn("sh", ["-c", `sleep 0.05; printf hi >&${fd}`], { stdio: ["ignore", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore"] });
const s = c.stdio[fd];
const seen = [];
s.on("data", () => { seen.push("data"); throw new Error("data-throw-fatal"); });
s.on("end", () => seen.push("end"));
s.on("close", () => seen.push("stream close"));
c.on("exit", () => seen.push("child exit"));
c.on("close", () => seen.push("child close"));
process.on("exit", code => console.log(JSON.stringify({ fd, code, seen })));
