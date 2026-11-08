// feed.mjs has a top-level await, so the graph of this entry point does not run to its end before the require() in tools.cjs returns: it does not run first.
// The lines are those of `bun <file>`. `bun build --compile` builds no such program, and Node.js refuses the require().
import "./tools.cjs";
import { count } from "./feed.mjs";
export var title = "main";
console.log("main begins");
try {
  console.log("main reads", count);
} catch (error) {
  console.log("main reads and throws", error.name);
}
setTimeout(() => console.log("the end", count), 1);
/* Output:
tools<
main begins
main reads and throws ReferenceError
feed sees default,early
feed goes on
the end 1
*/
