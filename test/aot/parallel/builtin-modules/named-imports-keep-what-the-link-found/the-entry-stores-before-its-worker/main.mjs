// The entry stores into its node:path, then a Worker with the same imports stores into its own: what one thread stores does not reach the named imports or the module of the other.
import path, { sep, join } from "node:path";
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
path.join = () => "patched by the entry";
path.sep = "?";
console.log("the worker", await listen(new Worker(new URL("./w.mjs", import.meta.url))));
console.log("the entry says", sep, join("a", "b"), path.sep, path.join("a", "b"));
