// throws.cjs runs while the graph of this entry point is loaded. The module that it requires calls import() on it. The call waits for the file, which throws: the load of the entry point fails.
// `bun run` takes the steps of the call inside the require(), so its loader has the file before the file throws, and goes on.
// Bun reports the error of an entry point behind the jobs that are queued, `bun build --compile` too: the handler of the rejected import() runs first. Node.js ends at the error.
import "./throws.cjs";
import "./deeper.mjs";
console.log("main runs");
/* Output:
throws begins
imports-back begins
imports-back ends
imports-back then throws RangeError
exit code 1
RangeError: half-way
*/
