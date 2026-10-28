// a.mjs and one line that never runs, which calls the global function.
import vm from "node:vm";
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = vm.runInThisContext(decoded("let atob = 1; 'declared'")); } catch (error) { answer = error.name; }
if (never) console.log(atob(""));
console.log(answer);
