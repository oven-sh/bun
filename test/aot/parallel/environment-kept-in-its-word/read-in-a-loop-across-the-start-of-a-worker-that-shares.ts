// read in a loop across the start of a worker that shares
import { SHARE_ENV, Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const first = process.env, firstOfBun = Bun.env;
  const seen: unknown[] = [];
  let worker: Worker | undefined;
  for (let i = 0; i < 4; i++) {
    const inFront = process.env;
    if (i === 1) worker = new Worker(new URL(import.meta.url), { env: SHARE_ENV });
    seen.push(inFront === first, process.env === first, Bun.env === firstOfBun, process.env === Bun.env);
  }
  console.log(seen.join());
  worker!.postMessage("go");
  console.log(await new Promise(resolve => worker!.once("message", resolve)), process.env.SET_BY_WORKER, Bun.env.SET_BY_WORKER);
  await worker!.terminate();
} else {
  parentPort!.once("message", () => {
    process.env.SET_BY_WORKER = "set";
    parentPort!.postMessage(process.env === Bun.env);
  });
}
