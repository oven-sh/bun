// The program loads a built-in module by a name that it puts together while it runs.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = typeof (await import(decoded("node:zlib"))).gzipSync; } catch (error) { answer = error.code ?? error.name; }
console.log(answer);
