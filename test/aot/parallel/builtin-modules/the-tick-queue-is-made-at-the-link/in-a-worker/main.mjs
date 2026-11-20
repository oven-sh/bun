// The file of a Worker has an import of node:fs that nothing reads: the link of that file makes the tick queue of the thread, and its first tick runs behind its promise jobs.
import { sep } from "node:path";
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
console.log("the worker with the import", await listen(new Worker(new URL("./with.mjs", import.meta.url))));
console.log("the worker without it", await listen(new Worker(new URL("./without.mjs", import.meta.url))));
console.log(typeof sep);
