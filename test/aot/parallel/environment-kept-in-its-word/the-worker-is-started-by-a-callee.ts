// the worker is started by a callee
import { SHARE_ENV, Worker, isMainThread } from "node:worker_threads";
function start() { return new Worker(new URL(import.meta.url), { env: SHARE_ENV }); }
function both(run: () => Worker) { const a = process.env; const worker = run(); const b = process.env; return [a === b, worker] as const; }
if (isMainThread) {
  const [same, worker] = both(start);
  const [sameAgain, second] = both(start);
  console.log(same, sameAgain);
  await worker.terminate();
  await second.terminate();
}
