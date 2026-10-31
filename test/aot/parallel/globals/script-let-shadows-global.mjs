// A script's let shadows a global that was read.
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
globalThis.shade = "property";
function read() { return shade; }
function member() { return globalThis.shade; }
function store(value) { shade = value; }
attempt(read);
attempt(read);
attempt(member);
vm.runInThisContext("let shade = 'variable';");
attempt(read);
attempt(read);
attempt(member);
store("stored by name");
attempt(read);
attempt(member);
attempt(() => vm.runInThisContext("shade"));
attempt(() => delete globalThis.shade);
attempt(read);
attempt(member);
console.log(told.join("\n"));
