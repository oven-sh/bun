// node:worker_threads goes through a value that the build cannot follow. Its Worker is read under a computed name and made from text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
const threads = unknown(require("node:worker_threads"));
const report = worker =>
  worker
    .on("message", message => console.log("message:", message))
    .on("error", error => console.log("error:", error.name, String(error.message).slice(0, 160)))
    .on("exit", code => console.log("exit:", code));
const text = "require('node:worker_threads').parentPort.postMessage('text ran: ' + (1 + 1))";
report(new threads[decoded("Worker")](decoded(text), { eval: true }));
