import { Worker } from "node:worker_threads";
export const start = () =>
  new Promise(done => {
    const worker = new Worker(
      'import("' +
        import.meta.url +
        '/../named-in-the-text-alone.mjs").then(job => job.said, error => "threw " + [error.name, error.message, error.specifier, error.referrer].join(" | ")).then(said => require("node:worker_threads").parentPort.postMessage(said))',
      { eval: true },
    );
    worker.on("message", said => (worker.terminate(), done("said " + said)));
    worker.on("error", error => done("error " + error.name));
  });
