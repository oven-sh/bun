// The program finds eval under a computed name on an object that has been through native code.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = unknown(globalThis)[decoded("eval")](decoded("1 + 1")); } catch (error) { answer = error.name; }
console.log(answer);
