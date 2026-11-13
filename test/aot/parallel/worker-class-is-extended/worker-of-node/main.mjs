import { Worker } from "node:worker_threads";
class JobWorker extends Worker {}
const name = process.argv[2] ?? "a";
const worker = new JobWorker(new URL("./jobs/" + name + ".mjs", import.meta.url));
worker.on("message", text => {
  console.log(text);
  worker.terminate();
});
