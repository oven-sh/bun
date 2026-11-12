const { spawn } = require("node:child_process");
const t0 = Date.now();
const c = spawn("sleep", ["2"]);
const t1 = Date.now();
c.unref();
if (process.env.MODE === "none") { c.stdout.destroy(); c.stderr.destroy(); c.stdin.destroy(); }
process.on("beforeExit", () => console.log("beforeExit at", Date.now() - t0));
process.on("exit", () => console.log("spawn took", t1 - t0, "exit at", Date.now() - t0));
