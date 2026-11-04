// a worker with a copy
import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const before = process.env;
  process.env.OF_MAIN = "main";
  const worker = new Worker(new URL(import.meta.url));
  console.log(await new Promise(resolve => worker.once("message", resolve)), process.env === before, process.env.SET_BY_WORKER);
  await worker.terminate();
} else {
  process.env.SET_BY_WORKER = "set";
  parentPort!.postMessage([process.env.OF_MAIN, process.env.SET_BY_WORKER].join());
}
