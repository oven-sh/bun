// requires-main.cjs requires this module while this module's imports are loaded, so that require() loads the rest of them. One is file.cjs, which requires an ES module that imports it back and then replaces its exports.
// Every module that imports file.cjs reads one set of names: those of that moment while the file runs, and what the file has exported at its end from then on. Plain Bun prints another output.
import "./requires-main.cjs";
import * as file from "./file.cjs";
console.log("main", shown(file), shown(file.default));
import("./file.cjs").then(late => {
  console.log("import()", shown(late), shown(late.default), late === file);
  readInCycle();
});
/* Output:
requires-main begins
file begins
imports-back object default,early object early
file ends
main object default,late,length,name,prototype function late
requires-main ends
import() object default,late,length,name,prototype function late true
imports-back again object default,late,length,name,prototype function late
*/
