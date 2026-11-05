// lib.cjs requires a.mjs, which imports lib.cjs again, and replaces module.exports behind that. A module runs behind the files that it imports: "main runs" comes behind "lib ends".
// `bun <file>` prints "main runs" in the middle of lib.cjs, while require() waits for the text of a.mjs; with its transpiler on one thread it prints what stands here. The plain executable has { v: 7 } where both have {}.
import "./other.mjs";
import d from "./lib.cjs";
import * as n from "./lib.cjs";
console.log("main runs", d === n.default, JSON.stringify(d), JSON.stringify(n.default));
setTimeout(() => console.log("later", d === n.default, JSON.stringify(d), JSON.stringify(n.default)));

/* Output:
lib starts
a runs
lib behind the require
lib ends
other runs
main runs true {} {}
later true {} {}
*/
