// A script's let shadows a name the global object inherits.
const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
const told = [];
function attempt(action) {
  try {
    told.push(String(action()));
  } catch (error) {
    told.push(error instanceof TypeError ? error.name : error.name + ": " + error.message);
  }
}
import vm from "node:vm";
function read() { return toString; }
function kind() { return typeof toString; }
attempt(kind);
attempt(kind);
attempt(() => read() === Object.prototype.toString);
vm.runInThisContext("let toString = 1;");
attempt(read);
attempt(kind);
attempt(() => typeof globalThis.toString);
console.log(told.join("\n"));
