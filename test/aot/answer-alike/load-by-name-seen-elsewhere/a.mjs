// The program finds getBuiltinModule under a computed name on an object that has been through native code.
import "node:path";
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { answer = typeof unknown(process)[decoded("getBuiltinModule")](decoded("node:path")).join; } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 23); }
console.log(answer);
