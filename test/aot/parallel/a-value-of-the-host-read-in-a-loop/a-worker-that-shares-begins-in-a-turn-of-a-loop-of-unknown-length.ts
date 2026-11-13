import { SHARE_ENV, Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const turns: number = JSON.parse("11");
  let worker: Worker | undefined;
  function run(n: number): string {
    let seen = "";
    for (let i = 0; i < n; i++) {
      process.env.K82_STEP = String(i);
      if (i === 3) worker = new Worker(new URL(import.meta.url), { env: SHARE_ENV });
      seen += process.env.K82_STEP + ";";
    }
    return seen;
  }
  console.log(run(turns), process.env.K82_STEP, Bun.env.K82_STEP);
  worker!.postMessage("go");
  console.log(await new Promise(resolve => worker!.once("message", resolve)));
  await worker!.terminate();
} else {
  parentPort!.once("message", () => parentPort!.postMessage(process.env.K82_STEP + " " + (process.env === Bun.env)));
}
