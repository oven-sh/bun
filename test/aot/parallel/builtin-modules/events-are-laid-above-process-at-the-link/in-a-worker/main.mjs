// The link of the file of a Worker lays EventEmitter.prototype above the prototype of the worker's process, for an import of node:zlib that nothing reads, and leaves the process of the entry as it was.
import { sep } from "node:path";
function listen(worker) {
  return new Promise(resolve => {
    worker.onmessage = event => resolve("says " + event.data);
    worker.onerror = event => (event.preventDefault(), resolve("fails"));
  }).finally(() => worker.terminate());
}
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("the entry before:", above());
console.log("the worker", await listen(new Worker(new URL("./w.mjs", import.meta.url))));
console.log("the entry behind:", above(), typeof sep);
