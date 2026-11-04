// a worker that shares its environment
import { SHARE_ENV, Worker, isMainThread, parentPort } from "node:worker_threads";
const p: any = process;
p[JSON.parse('"notAMember"')] = 1;
if (isMainThread) {
  const first = process.env;
  const seen: unknown[] = [];
  let worker: Worker | undefined;
  for (let i = 0; i < 4; i++) {
    const inFront = process.env;
    if (i === 1) worker = new Worker(new URL(import.meta.url), { env: SHARE_ENV });
    seen.push(inFront === first, process.env === first, process.env === Bun.env);
  }
  console.log(seen.join());
  worker!.postMessage("go");
  console.log(await new Promise(resolve => worker!.once("message", resolve)), process.env.SET_BY_WORKER);
  await worker!.terminate();
} else {
  parentPort!.once("message", () => {
    const mine = process.env;
    process.env.SET_BY_WORKER = "set";
    parentPort!.postMessage([process.env === mine, process.env === Bun.env].join());
  });
}
