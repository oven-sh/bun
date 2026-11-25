// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
// The load of back.mjs has gone through the requests of the entry, so the step that the load of the entry waits for lies in the queue of that load. The load for second.cjs settles second.cjs, for which the load of back.mjs waited:
// that load ends inside the require and the cycle is entered at back.mjs: main runs first.
import "./first.cjs";
import "./back.mjs";
console.log("main runs");
export const answer = [1].length;
/* Output:
first begins
second begins
main runs
back runs
second got 1
second ends
first got 1
first ends
*/
