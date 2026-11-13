const { spawn } = require("node:child_process");
const c = spawn("sh", ["-c", "sleep 0.05; echo hi >&3"], { stdio: ["ignore", "ignore", "ignore", "pipe"] });
c.stdio[3].on("data", () => { throw new Error("data-throw-fatal"); });
