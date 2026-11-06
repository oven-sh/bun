// A worker with `env: SHARE_ENV` shares one environment with the thread that makes it: the host puts another object under process.env and Bun.env of that thread,
// and a store of either thread is seen by the other, whichever of the three names reads it.
import { SHARE_ENV, Worker, isMainThread, parentPort } from "node:worker_threads";
function read(): string { return String(process.env.SHARED) + "/" + String(Bun.env.SHARED) + "/" + String(import.meta.env.SHARED); }
if (isMainThread) {
  const before = [process.env, Bun.env];
  process.env.SHARED = "main";
  console.log(read());
  for (let round = 0; round < 2; round++) {
    const worker = new Worker(new URL(import.meta.url), { env: SHARE_ENV });
    console.log(process.env === before[0], Bun.env === before[1], process.env === Bun.env, read());
    worker.postMessage("go");
    const said = await new Promise(resolve => worker.once("message", resolve));
    await new Promise(resolve => worker.once("exit", resolve));
    console.log(said, read());
    process.env.SHARED = "main again";
  }
  const own = new Worker(new URL(import.meta.url), { env: { SHARED: "its own" } });
  own.postMessage("go");
  console.log(await new Promise(resolve => own.once("message", resolve)), read());
} else {
  parentPort!.once("message", () => {
    const found = read();
    process.env.SHARED = "worker";
    parentPort!.postMessage(found + " > " + read());
  });
}
