import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

export async function run() {
  const helper = new Worker(fileURLToPath(import.meta.url), { workerData: 7 });
  helper.on("message", word => console.log("message", word));
  helper.on("error", error => console.log("error", String(error.message).slice(0, 11)));
  await new Promise(done => helper.on("exit", done));
}
if (!isMainThread) parentPort!.postMessage("ran with " + workerData);
