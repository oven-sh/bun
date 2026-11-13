// Raw stdio[3] (no facade): data and EOF arrive together; the 'data' listener throws; no 'uncaughtException' handler.
const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", process.argv[2] || "printf hi >&3"], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
const s = c.stdio[3];
const seen = [];
s.on("data", () => { seen.push("data"); throw new Error("boom"); });
s.on("end", () => seen.push("end"));
s.on("close", () => seen.push("socket-close"));
c.on("exit", () => seen.push("child-exit"));
c.on("close", () => seen.push("child-close"));
process.on("exit", code => console.log(JSON.stringify({ code, seen })));
