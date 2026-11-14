// Stores to Error.stackTraceLimit at one place, before and after the property is read-only, an accessor, deleted and defined again.
const lines = [];
const frames = error => typeof error.stack === "string" ? error.stack.split("\n").length - 1 : String(error.stack);
function deep(n, make) { const error = n ? deep(n - 1, make) : make(); error.depth = n; return error; }
const made = () => deep(5, () => { const error = new Error("m"); error.made = true; return error; });
function store(values) {
  let seen = "";
  for (const value of values) {
    try { Error.stackTraceLimit = value; seen += "stored "; } catch (error) { seen += error.constructor.name + " "; }
    const limit = Error.stackTraceLimit;
    seen += String(limit) + ":" + frames(made()) + " ";
  }
  return seen;
}
function storeKey(key, values) { let seen = ""; for (const value of values) { try { Error[key] = value; seen += "stored "; } catch (error) { seen += error.constructor.name + " "; } seen += String(Error[key]) + " "; } return seen; }
const initial = Error.stackTraceLimit;
const descriptor = () => { const d = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit"); return d ? ["value" in d, d.writable, d.enumerable, d.configurable].join() : "none"; };
let held = 4, asked = 0, set = 0;
const steps = {
  open() {},
  readOnly() { Object.defineProperty(Error, "stackTraceLimit", { value: 2, writable: false, configurable: true, enumerable: true }); },
  openAgain() { Object.defineProperty(Error, "stackTraceLimit", { value: 3, writable: true, configurable: true, enumerable: true }); },
  accessor() { Object.defineProperty(Error, "stackTraceLimit", { get() { asked++; return held; }, set(value) { set++; held = value; }, configurable: true, enumerable: true }); },
  getterAlone() { Object.defineProperty(Error, "stackTraceLimit", { get() { asked++; return 1; }, set: undefined, configurable: true, enumerable: true }); },
  value() { Object.defineProperty(Error, "stackTraceLimit", { value: 5, writable: true, configurable: true, enumerable: true }); },
  hidden() { Object.defineProperty(Error, "stackTraceLimit", { value: 2, writable: true, configurable: true, enumerable: false }); },
  deleted() { delete Error.stackTraceLimit; },
};
for (const [name, step] of Object.entries(steps)) {
  let outcome = "done";
  try { step(); } catch (error) { outcome = error.constructor.name; }
  lines.push(name + " " + outcome + " " + descriptor() + " | " + store([1, 4, 2, 3]) + "| " + storeKey("stackTraceLimit", [3, 1]) + descriptor() + " " + asked + " " + set);
}
for (const line of lines) console.log(line);
