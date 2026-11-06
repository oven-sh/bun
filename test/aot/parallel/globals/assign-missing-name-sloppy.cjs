// Assigning to a missing name in sloppy code.
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
function store(value) { fresh = value; }
function read() { return fresh; }
function kind() { return typeof fresh; }
attempt(kind);
attempt(read);
attempt(() => store(1));
attempt(kind);
attempt(read);
attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "fresh")));
globalThis.fresh = 2;
attempt(read);
attempt(() => store(3));
attempt(read);
attempt(() => Reflect.deleteProperty(globalThis, "fresh"));
attempt(kind);
attempt(() => store(4));
attempt(kind);
console.log(told.join("\n"));
