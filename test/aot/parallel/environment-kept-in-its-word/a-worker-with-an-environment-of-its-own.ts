// a worker with an environment of its own
import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const before = process.env;
  process.env.OF_MAIN = "main";
  const worker = new Worker(new URL(import.meta.url), { env: { OF_WORKER: "worker" } });
  console.log(process.env === before);
  console.log(await new Promise(resolve => worker.once("message", resolve)), process.env === before, process.env.OF_WORKER, process.env.SET_BY_WORKER);
  await worker.terminate();
} else {
  const first = process.env;
  process.env.SET_BY_WORKER = "set";
  parentPort!.postMessage([process.env.OF_MAIN, process.env.OF_WORKER, process.env === first, process.env === Bun.env].join());
}
