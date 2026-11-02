// Gc, which --expose-gc adds at run time.
// Env: BUN_OPTIONS=--expose-gc
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
function kinds() { return [typeof gc, typeof globalThis.gc, "gc" in globalThis].join(); }
function collect() { return typeof gc === "function" ? typeof gc() : "no gc"; }
function member() { return globalThis.gc === undefined ? "no member" : typeof globalThis.gc(); }
attempt(kinds);
attempt(kinds);
attempt(collect);
attempt(member);
attempt(() => gc.name);
console.log(told.join("\n"));
