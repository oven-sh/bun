import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { spawn } from "node:child_process";
if (isMainThread) {
  const mode = process.argv[2] || "terminate";
  let done = 0;
  const N = 3;
  for (let i = 0; i < N; i++) {
    const w = new Worker(new URL(import.meta.url), { argv: [mode] });
    w.on("message", m => {
      if (m === "flowing") {
        if (mode === "terminate") w.terminate();
      }
    });
    w.on("error", e => console.log("worker error", e.message));
    w.on("exit", code => { if (++done === N) { console.log("all workers exited", mode); } });
  }
} else {
  const mode = process.argv[2];
  const c = spawn("yes", [], { stdio: ["ignore", "pipe", "pipe"] });
  let n = 0;
  c.stdout.on("data", d => {
    if (++n === 3) {
      parentPort.postMessage("flowing");
      if (mode === "exit") process.exit(0);
      if (mode === "throw") throw new Error("boom in worker");
    }
  });
}
