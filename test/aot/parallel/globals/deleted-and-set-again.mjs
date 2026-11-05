// A global that is deleted and set again.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
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
globalThis.temporary = "here";
function read() { return temporary; }
function kind() { return typeof temporary; }
attempt(read);
attempt(read);
attempt(kind);
attempt(() => delete globalThis.temporary);
attempt(read);
attempt(kind);
attempt(() => "temporary" in globalThis);
globalThis.temporary = "back";
attempt(read);
attempt(kind);
console.log(told.join("\n"));
