// (d) terminate the worker from inside: process.exit() in the worker's 'data' listener.
const { Worker, isMainThread } = require("node:worker_threads");
if (isMainThread) {
  const w = new Worker(__filename);
  w.on("exit", code => { console.log("worker exit", code); setTimeout(() => { Bun.gc(true); console.log("ok"); }, 200); });
} else {
  const { spawn } = require("node:child_process");
  const c = spawn("sh", ["-c", "i=0; while [ $i -lt 300000 ]; do printf yyyyyyyyyyyyyyyy; i=$((i+1)); done"], { stdio: ["ignore", "pipe", "pipe"] });
  let n = 0;
  c.stdout.on("data", () => { if (++n === 3) process.exit(5); });
}
