// throws.cjs runs while the graph of this entry point is loaded. The module that it requires calls import() on it. The call waits for the file, which throws: the load of the entry point fails.
// `bun run` takes the steps of the call inside the require(), so its loader has the file before the file throws, and goes on.
// Todo: node ends at the error. The executable runs the handler of the rejected import() first.
import "./throws.cjs";
import "./deeper.mjs";
console.log("main runs");
/* Output:
throws begins
imports-back begins
imports-back ends
exit code 1
RangeError: half-way
*/
