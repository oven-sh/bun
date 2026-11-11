// lib.cjs requires a.mjs, which imports lib.cjs again, and replaces module.exports behind that. The lines are those of `bun <file>`, in 14 of 16 runs: the load for that require settles lib.cjs as far as it has run,
// the load of the entry waited for that alone and ends inside the require: "main runs" stands in the middle of lib.cjs. With its transpiler on one thread, and in the other 2 of the 16 runs, bun prints it behind "lib ends". The plain executable has { v: 7 } where both have {}.
import "./other.mjs";
import d from "./lib.cjs";
import * as n from "./lib.cjs";
console.log("main runs", d === n.default, JSON.stringify(d), JSON.stringify(n.default));
setTimeout(() => console.log("later", d === n.default, JSON.stringify(d), JSON.stringify(n.default)));

/* Output:
lib starts
a runs
other runs
main runs true {} {}
lib behind the require
lib ends
later true {} {}
*/
