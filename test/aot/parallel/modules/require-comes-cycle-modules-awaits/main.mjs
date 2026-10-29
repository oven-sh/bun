// A require comes into a cycle of modules that awaits while an import is loading it.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: what it prints depends on the turn in which the loader comes to the cycle, counted from the start of the entry point
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pending = import("./slow-a.mjs");
await 0;
await 0;
await 0;
await 0;
await 0;
await 0;
await 0;
await 0;
try {
  console.log(require("./slow-b.mjs").value);
} catch (error) {
  console.log(error.constructor.name, error.message.replace(/\S*slow-b.mjs/, "slow-b.mjs"));
}
await pending;
console.log(require("./slow-b.mjs").value);
/* Output:
slow-a begins
TypeError require() async module slow-b.mjs" is unsupported. use "await import()" instead.
slow-a ends
slow-b runs
43
*/
