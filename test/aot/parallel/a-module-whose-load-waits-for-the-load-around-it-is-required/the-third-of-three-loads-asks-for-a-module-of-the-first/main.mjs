// The lines are those of `bun <file>`, in 24 of 24 runs. It reads the texts on other threads, and on a busy machine some of its runs print another order.
// first.cjs requires back.mjs, second.cjs requires the entry inside that load, third.cjs requires side.mjs inside both. What the load of side.mjs waits for lies in the queue of the first load, two loads further out:
// nothing ends inside the third require and `bun <file>` throws. The modules run when third.cjs has returned, inside the require of second.cjs.
import "./first.cjs";
import "./back.mjs";
console.log("main runs");
export const answer = [1].length;
/* Output:
first begins
second begins
third begins
third caught TypeError
third ends
back runs
side runs
main runs
second got 1
second ends
first got 1
first ends
*/
