// The text of a.mjs, built with the lowest limit on the edges that the analysis logs.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
function run(text) { return (0, eval)(text); }
let answer;
try { answer = run(decoded("1 + 1")); } catch (error) { answer = error.name; }
console.log(answer);
