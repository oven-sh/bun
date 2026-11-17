// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { Worker } from "node:worker_threads";
function listen(worker) {
  return new Promise(resolve => {
    worker.on("message", data => resolve("says " + data));
    worker.on("error", () => resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log(await listen(new Worker(new URL("./absent.mjs", import.meta.url))));
