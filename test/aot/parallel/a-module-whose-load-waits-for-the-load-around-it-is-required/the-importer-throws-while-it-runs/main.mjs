// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
import "./first.cjs";
import "./second.cjs";
console.log("main runs");
export const answer = [42].length + 41;
/* Output:
first begins
second begins
main runs
back runs
second got 42
second ends
first caught back fails
first ends
*/
