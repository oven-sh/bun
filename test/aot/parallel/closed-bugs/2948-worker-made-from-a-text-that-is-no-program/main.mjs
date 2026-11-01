import { Worker } from "node:worker_threads";
const worker = new Worker('postMessage(throw new Error("boom"))', { eval: true });
worker.on("error", error => console.log("error:", error.name));
worker.on("exit", code => console.log("exit", code));
