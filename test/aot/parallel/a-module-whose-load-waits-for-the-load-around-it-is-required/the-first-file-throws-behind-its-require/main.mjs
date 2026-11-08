// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
import "./first.cjs";
import "./second.cjs";
import "./third.cjs";
console.log("main runs");
export const answer = [1].length;
/* Output:
first begins
second begins
third runs
main runs
back runs
second got 1
second ends
first got 1
first ends
*/
