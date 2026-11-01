// a.cjs runs while the loader loads the graph of main.mjs, and requires main.mjs: the rest of the graph is loaded inside that require().
// b.cjs runs there and requires c.mjs, which the same graph has asked for in front of b.cjs. `bun run` answers.
// With BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1 it throws "require() async module": there the step of c.mjs still waits. A program is run without that.
import "./a.cjs";
import "./c.mjs";
import "./b.cjs";
console.log("main runs");
/* Output:
e runs
d runs
b sees 1
caught sees 1
main runs
*/
