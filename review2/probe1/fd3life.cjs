const { spawn } = require("node:child_process");
const mode = process.argv[2];
const t0 = Date.now();
const c = spawn("sh", ["-c", "printf hi >&3; sleep 2"], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
c.unref();
if (mode === "touch") void c.stdio[3];
if (mode === "unref") c.stdio[3].unref();
if (mode === "data") c.stdio[3].on("data", () => {});
process.on("exit", () => console.log("fd3", mode, "lived", ((Date.now() - t0) / 1000).toFixed(1), "s"));
