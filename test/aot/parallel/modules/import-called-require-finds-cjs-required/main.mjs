// A CommonJS file requires an ES module that imports two CommonJS files. The first of them calls import() on the second, which the loader has asked for and not yet fetched: the call loads it. The second calls import() on the file that requires, so the loader of the run time loads the graph.
// Todo: node and `bun build --compile` run this module before either call has settled. The executable runs it between the two, `bun run` on one thread behind both.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
import "./lines.cjs";
import "./requires.cjs";
import "./imports.cjs";
lines.push("main runs");
/* Output:
requires begins
imports runs
asked-for runs
required runs: a2
requires ends
main runs
asked-for loaded
requires loaded
not settled: 
*/
