// A wrapper that exits with the child's code from 'exit' (not 'close'). The child writes a little and exits 0 at once; the 'data' listener throws; no 'uncaughtException' handler.
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 1;
const c = spawn("sh", ["-c", `sleep 0.05; printf hi >&${fd}`], { stdio: ["ignore", fd === 1 ? "pipe" : "ignore", "ignore", fd === 3 ? "pipe" : "ignore"] });
c.stdio[fd].on("data", () => { throw new Error("data-throw-fatal"); });
c.on("exit", code => process.exit(code));
