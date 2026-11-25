// Build prints: 0 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
function listen(worker) {
  return new Promise(resolve => {
    worker.on("message", data => resolve("says " + data));
    worker.on("error", () => resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log(typeof import.meta);
console.log(await listen(new Worker(new URL("./job.mjs", import.meta.url))));
console.log(await listen(new Worker(fileURLToPath(new URL("./job.mjs", import.meta.url)))));
