// The timeout of a node:vm script ends a loop in a CommonJS package that is marked external. The script drains the jobs, so the package is loaded inside it, for an importer whose CommonJS file, one level below, calls import().
// Nothing of the graph prints, so the output is the same wherever the timeout finds the script.
// Flags: --external outside-loop-until
import { drainMicrotasks } from "bun:jsc";
import vm from "node:vm";
globalThis.loops = true;
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
globalThis.loops = false;
setTimeout(() => console.log("later"), 10);
