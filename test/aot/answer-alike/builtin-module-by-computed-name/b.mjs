// a.mjs and one line that never runs, which names the module.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = typeof (await import(decoded("node:zlib"))).gzipSync; } catch (error) { answer = error.code ?? error.name; }
if (never) await import("node:zlib");
console.log(answer);
