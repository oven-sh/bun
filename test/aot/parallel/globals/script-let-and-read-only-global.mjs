// A script can't shadow a read-only global.
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
Object.defineProperty(globalThis, "fixed", { value: "fixed", writable: false, enumerable: true, configurable: false });
function read() { return fixed; }
attempt(read);
attempt(read);
attempt(() => vm.runInThisContext("let fixed = 'of the script';"));
attempt(read);
attempt(() => vm.runInThisContext("fixed"));
console.log(told.join("\n"));
