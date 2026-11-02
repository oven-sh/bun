// As workers/worker-of-text-from-module-handed-on, and the text of the Worker calls eval and new Function.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
const threads = unknown(require("node:worker_threads"));
const report = worker =>
  worker
    .on("message", message => console.log("message:", message))
    .on("error", error => console.log("error:", error.name, String(error.message).slice(0, 160)))
    .on("exit", code => console.log("exit:", code));
const text =
  "require('node:worker_threads').parentPort.postMessage([eval('2 + 3'), new Function('return 7')()].join(' '))";
report(new threads[decoded("Worker")](decoded(text), { eval: true }));
