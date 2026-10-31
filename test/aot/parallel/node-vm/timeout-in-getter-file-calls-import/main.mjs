// The timeout of a node:vm script ends a loop in a getter that the program put on process. The script drains the jobs, so node:process is generated inside it, for an importer whose CommonJS file calls import().
// Nothing of the graph prints, so the output is the same wherever the timeout finds the script.
import { drainMicrotasks } from "bun:jsc";
import vm from "node:vm";
let loops = true;
Object.defineProperty(process, "custom", {
  get() {
    while (loops);
    return 1;
  },
  enumerable: true,
  configurable: true,
});
const load = () => {
  import("./importer.mjs");
  drainMicrotasks();
};
try {
  vm.runInNewContext("load()", { load }, { timeout: 100 });
  console.log("no timeout");
} catch (error) {
  console.log(error.code);
}
loops = false;
setTimeout(() => console.log("later"), 10);
