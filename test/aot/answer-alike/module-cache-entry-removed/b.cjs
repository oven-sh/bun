// The same deletion with require named.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
globalThis.runs = 0;
require("./counted.cjs");
let answer;
try { delete require.cache[require.resolve("./counted.cjs")]; require("./counted.cjs"); answer = globalThis.runs; } catch (error) { answer = error.name; }
console.log(answer);
