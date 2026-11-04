// reads.mjs stands ahead of asks.cjs: its text comes first, and it has asked for below.mjs when asks.cjs runs and calls import(). So the last text of this graph comes ahead of the text
// of late.mjs, and this graph runs first. `bun run` reads on several threads, and under load the texts may come in another order: the lines are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import "./reads.mjs";
import "./asks.cjs";
console.log("main");
/* Output:
asks
below
reads
main
late
late is loaded
*/
