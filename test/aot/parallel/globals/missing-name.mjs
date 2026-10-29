// A missing name.
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
function member() { return globalThis.nope; }
function name() { return nope; }
function kind() { return typeof nope; }
function kindOfMember() { return typeof globalThis.nope; }
function has() { return "nope" in globalThis; }
function call() { return nope(); }
function callMember() { return globalThis.nope(); }
for (const action of [member, name, kind, kindOfMember, has, call, callMember]) {
  attempt(action);
  attempt(action);
}
console.log(told.join("\n"));
