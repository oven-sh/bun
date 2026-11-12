// between.mjs imports two CommonJS files, and the first of them queues the first tick of the process. The tick runs right behind that file, ahead of the second.
// `bun <file>` runs second.cjs first in seven runs of eight: which text the threads of its transpiler finish first decides. So what the executable prints stands here.
import "./between.mjs";
console.log("main runs");

/* Output:
first runs
tick of first
second runs
between runs
main runs
*/
