// Assigning to a read-only global in sloppy code.
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
Object.defineProperty(globalThis, "fixed", { value: "fixed", writable: false, enumerable: true, configurable: false });
function read() { return fixed; }
function store(value) { fixed = value; }
attempt(read);
attempt(read);
attempt(() => store("replaced"));
attempt(read);
attempt(() => Reflect.set(globalThis, "fixed", "replaced"));
attempt(() => Reflect.deleteProperty(globalThis, "fixed"));
attempt(read);
console.log(told.join("\n"));
