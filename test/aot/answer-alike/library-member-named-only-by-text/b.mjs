// a.mjs and one line that never runs, which reads process.stdout.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = (0, eval)(decoded("typeof process.stdout.write")); } catch (error) { answer = error.name; }
if (never) process.stdout.write("");
console.log(answer);
