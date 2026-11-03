// When asks.cjs calls import(), two levels of this graph are still to be read. A text comes a turn of the event loop after it was asked for, so late.mjs runs ahead of this graph, and
// later.mjs, which imports a module of its own, runs behind it. `bun run` reads on several threads, and under load the texts may come in another order: the lines are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import "./asks.cjs";
import "./first.mjs";
console.log("main");
/* Output:
asks
late
late is loaded
asks again
third
second
first
main
below later
later
later is loaded
*/
