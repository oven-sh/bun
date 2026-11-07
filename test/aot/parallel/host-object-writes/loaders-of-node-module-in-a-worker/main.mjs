// A Worker has an object of node:module of its own, and it is locked too.
import M from "node:module";
import { Worker, isMainThread } from "node:worker_threads";
if (isMainThread) new Worker(import.meta.filename);
else {
  for (const change of [
    () => {
      M.createRequire = () => name => console.log("mine", name);
    },
    () => {
      M.Module = {};
    },
  ]) {
    try {
      change();
      console.log("done");
    } catch (error) {
      console.log(String(error).split(" (bun compile")[0]);
    }
  }
  M.createRequire(import.meta.url)("./next.cjs");
}
/* Output:
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
the next file
*/
