// A host global replaced after it was read.
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
function read() { return fetch; }
function call(url) { return fetch(url); }
function copy(value) { return structuredClone(value); }
const original = fetch;
attempt(() => read() === original);
attempt(() => read() === original);
attempt(() => copy("a copy"));
globalThis.fetch = url => "not fetched: " + url;
attempt(() => read() === original);
attempt(() => call("x:"));
structuredClone = value => "not cloned: " + value;
attempt(() => copy("a copy"));
attempt(() => globalThis.structuredClone("by member"));
globalThis.fetch = original;
attempt(() => read() === original);
console.log(told.join("\n"));
