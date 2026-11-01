// As workers/worker-of-text-from-module-handed-on, and the text of the Worker requires modules of the run time and calls what they export.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
const threads = unknown(require("node:worker_threads"));
const report = worker =>
  worker
    .on("message", message => console.log("message:", message))
    .on("error", error => console.log("error:", error.name, String(error.message).slice(0, 160)))
    .on("exit", code => console.log("exit:", code));
const text = `
const zlib = require("node:zlib");
require("node:worker_threads").parentPort.postMessage(
  [
    require("node:path").posix.join("a", "b"),
    zlib.gunzipSync(zlib.gzipSync("z")).toString(),
    require("node:util").format("%d", 7),
    typeof require("node:fs").readFileSync,
  ].join(" "),
);`;
report(new threads[decoded("Worker")](decoded(text), { eval: true }));
