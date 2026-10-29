// The entry point imports two CommonJS files, a module that is not there, and one more file.
// Flags: --external ./absent.mjs
import "./first.cjs";
import "./second.cjs";
import "./absent.mjs";
import "./third.cjs";
console.log("body of the entry point");
/* Output:
first runs
second runs
job of second
exit code 1
exit code 1
error: Cannot find module './absent.mjs' from '/$bunfs/root/main.mjs'
*/
