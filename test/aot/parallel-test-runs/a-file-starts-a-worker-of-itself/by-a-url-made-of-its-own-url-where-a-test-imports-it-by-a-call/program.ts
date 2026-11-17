import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

if (isMainThread) {
  const helper = new Worker(new URL(import.meta.url), { workerData: 7 });
  helper.on("message", word => console.log("message", word));
  helper.on("error", error => console.log("error", String(error.message).slice(0, 11)));
  await new Promise(done => helper.on("exit", done));
} else {
  parentPort!.postMessage("ran with " + workerData);
}
