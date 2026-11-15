// A getter that a loop over names or a table defines is found and tested before a loop that changes nothing it depends on. What changes between two runs of the loop, and what the loop itself writes, is seen.
// STATISTIC: GettersExpectedInLoops >= 4
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const lines = [];
function make(b) { const o = {}; for (const name of ["a", "bb", "ccc"]) Object.defineProperty(o, name, { configurable: true, enumerable: true, get() { return this.base + name.length; } }); o.base = b; return o; }
const define = (target, all) => { for (const key in all) Object.defineProperty(target, key, { configurable: true, enumerable: true, get: all[key] }); };
let v = 2, w = 0.5; const lib = {}; function add(x) { return x + v; }
define(lib, { value: () => v, half: () => w, add: () => add });
function sum(o, turns) { let n = 0; for (let k = 0; k < turns; k++) n += o.a + o.bb + o.ccc; return n; }
function writes(o, other, turns) { let n = 0; for (let k = 0; k < turns; k++) { other.base = k & 3; n += o.a + o.bb; } return n; }
function ofLib(turns) { let n = 0; for (let k = 0; k < turns; k++) n += lib.value + lib.half; return n; }
function ofLibAndVariable(turns) { let n = 0; for (let k = 0; k < turns; k++) { v = k & 7; n += lib.value; } return n; }
function calls(turns) { let n = 0; for (let k = 0; k < turns; k++) n += lib.add(k & 3); return n; }
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
const tell = (...fs) => lines.push(fs.map(attempt).join(" "));
const o = make(1), p = make(2.5);
const all = () => tell(() => sum(o, 0), () => sum(o, 3), () => sum(o, 200), () => sum(p, 50), () => writes(o, p, 50), () => writes(o, o, 50), () => ofLib(100), () => ofLibAndVariable(60), () => calls(60));
all(); all();
v = 0.25; w = -0; o.base = 2 ** 31; all();
o.base = "t"; all();
o.base = NaN; w = "half"; all();
Object.defineProperty(o, "a", { configurable: true, get() { return -5; } }); all();
Object.defineProperty(o, "bb", { configurable: true, writable: true, value: 7 }); o.base = 1; all();
delete o.ccc; all();
Object.setPrototypeOf(o, { ccc: 4 }); all();
Object.defineProperty(lib, "value", { configurable: true, get: () => 1000 }); all();
Object.defineProperty(lib, "add", { configurable: true, get: () => (x) => x * 2 }); all();
Object.defineProperty(p, "ccc", { configurable: true, get() { throw new RangeError("no ccc"); } }); all();
lines.push(show([o.base, p.base, v, w]));
console.log(lines.join("\n"));
