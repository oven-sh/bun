// The entry point imports CommonJS files, packages and ES modules. One file queues the first tick of the process, a job and an immediate: the tick runs right behind the file, ahead of the files behind it.
// `bun <file>` prints three orders in twelve runs: which text the threads of its transpiler finish first decides. Held to one thread it prints what the executable prints, which stands here.
import "early";
import "./queues.cjs";
import "./module.mjs";
import "late";
import "./last.cjs";
console.log("main runs");

/* Output:
early runs
queues runs
tick
late runs
last runs
job
module runs
main runs
immediate
*/
