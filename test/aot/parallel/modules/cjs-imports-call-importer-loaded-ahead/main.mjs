// file.cjs runs while the graph of this module is loaded, and calls import() on a second file. The second file runs a fixed number of jobs later, ahead of this module. Plain Bun prints another output.
import "./file.cjs";
console.log("main runs");
/* Output:
file runs
second runs
main runs
*/
