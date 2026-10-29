// between.mjs imports two CommonJS files, and the first of them queues a tick. The tick runs behind both files and ahead of between.mjs. Plain Bun prints another output.
import "./between.mjs";
console.log("main runs");
/* Output:
first runs
second runs
tick of first
between runs
main runs
*/
