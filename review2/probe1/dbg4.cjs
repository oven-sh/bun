// A 'data' listener that throws inside a Worker with no handler: Node ends the worker with 'error'.
const { Worker, isMainThread } = require("node:worker_threads");
if (isMainThread) {
  const w = new Worker(__filename, { stdout: false });
  w.on("error", e => console.log("worker error:", e.message));
  w.on("exit", code => { console.log("worker exit", code); setTimeout(() => { globalThis.Bun?.gc(true); console.log("ok"); }, 200); });
} else {
  const { spawn } = require("node:child_process");
  const c = spawn("sh", ["-c", "printf a; sleep 0.2; printf b; sleep 0.2; printf c"], { stdio: ["ignore", "pipe", "ignore"] });
  let n = 0;
  c.stdout.on("data", d => { n++; console.log("data", n); throw new Error("boom " + n); });
  c.stdout.on("end", () => console.log("end"));
  c.on("close", code => console.log("child close", code));
}
