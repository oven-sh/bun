// (c) a Worker that spawns a child; the main thread terminates it while the child is writing.
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
if (isMainThread) {
  const w = new Worker(__filename);
  w.on("message", m => { if (m === "data") { w.terminate().then(code => { console.log("terminated", code); setTimeout(() => { Bun.gc(true); console.log("ok"); }, 200); }); } });
  w.on("error", e => console.log("worker error", e.message));
} else {
  const { spawn } = require("node:child_process");
  const c = spawn("sh", ["-c", "i=0; while [ $i -lt 300000 ]; do printf yyyyyyyyyyyyyyyy; i=$((i+1)); done"], { stdio: ["ignore", "pipe", "ignore"] });
  let n = 0;
  c.stdout.on("data", () => { if (++n === 3) parentPort.postMessage("data"); const end = Date.now() + 5; while (Date.now() < end); });
}
