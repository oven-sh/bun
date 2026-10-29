// a.mjs and one line that never runs, which applies eval.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = unknown(globalThis)[decoded("eval")](decoded("1 + 1")); } catch (error) { answer = error.name; }
if (never) (0, eval)(decoded("0"));
console.log(answer);
