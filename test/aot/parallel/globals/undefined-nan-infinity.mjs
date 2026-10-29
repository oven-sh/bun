// GlobalThis.undefined, globalThis.NaN and globalThis.Infinity.
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
function members() { return [globalThis.undefined, globalThis.NaN, globalThis.Infinity, -globalThis.Infinity].join(); }
function kinds() { return [typeof globalThis.undefined, typeof globalThis.NaN, typeof globalThis.Infinity].join(); }
attempt(members);
attempt(kinds);
attempt(() => globalThis.undefined === undefined && "undefined" in globalThis);
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "undefined")));
console.log(told.join("\n"));
