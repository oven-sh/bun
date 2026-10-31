// A global that becomes a getter, then a value again.
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
globalThis.level = 1;
function read() { return level; }
function store(value) { level = value; }
attempt(read);
attempt(read);
let asked = 0;
Object.defineProperty(globalThis, "level", {
  get() { return "asked " + ++asked; },
  set(value) { told.push("set " + value); },
  configurable: true,
});
attempt(read);
attempt(read);
attempt(() => store(7));
attempt(read);
Object.defineProperty(globalThis, "level", { value: "a value again", writable: true, configurable: true });
attempt(read);
attempt(read);
attempt(() => store("stored"));
attempt(read);
attempt(() => asked);
console.log(told.join("\n"));
