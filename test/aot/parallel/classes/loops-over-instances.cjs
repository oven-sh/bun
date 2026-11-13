// STATISTIC: InstanceNamesReadByLoops >= 4
// `for (const k in o) o[k]`: an instance of a class gives its fields, and what lies on prototypes only where somebody put it there.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const describe = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? "{}" : String(v);

class Point { constructor(x, y) { this.x = x; this.y = y; this.next = null; } sum() { return this.x + this.y; } step(k) { this.x = (this.x + k) & 1023; if (this.next) this.y = this.next.y; return this; } get double() { return this.x * 2; } static of(x) { return new Point(x, x); } #hidden = 1; }
function hot(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const p = new Point(i, i + 1); p.next = i ? list[i - 1] : null; list.push(p); } for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; } return total; }
function total(o) { let sum = 0; for (const k in o) if (typeof o[k] === "number") sum += o[k]; return sum; }
function copy(o) { const r = new Point(0, 0); for (const k in o) r[k] = o[k]; return r; }
function record(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
function own(o) { const r = new Point(0, 0); for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
tell("hot", () => hot(1000));
tell("total", () => [total(new Point(1, 2)), total(new Point(1.5, "a"))]);
tell("copy", () => { const p = copy(new Point(3, 4)); return [Object.keys(p), p.sum(), p instanceof Point, p.double]; });
tell("record", () => record(new Point(5, new Point(1, 2))));
tell("own", () => { const p = own(new Point(7, 8)); return [Object.keys(p), p.step(1).sum()]; });
tell("local", () => { const p = new Point(1, 2); let text = ""; for (const k in p) text += k + describe(p[k]); p.late = "l"; for (const k in p) text += k + describe(p[k]); return text; });
tell("this", () => { class Own { constructor() { this.a = 1; this.b = "2"; } list() { const r = []; for (const k in this) r.push(k + this[k]); return r; } clone() { const o = new Own(); for (const k in this) o[k] = this[k]; return o; } } const o = new Own(); o.b = 3; return [o.list(), o.clone()]; });
tell("written", () => { const p = new Point(1, 2); for (const k in p) p[k] = k === "next" ? null : p[k] + 1; return p; });
tell("deleted", () => { const p = new Point(1, 2); const seen = []; for (const k in p) { seen.push(k); if (k === "x") delete p.y; } return [seen, p]; });

class Mixed { constructor(a) { this.a = a; } m() { return 1; } }
Object.assign(Mixed.prototype, { extra: "mixed" });
tell("assigned", () => { let sum = 0; const o = new Mixed(1); for (const k in o) sum += o[k]; return sum; });
class Put { constructor(a) { this.a = a; } m() { return 1; } }
Put.prototype.later = "put";
tell("put", () => { let sum = 0; const o = new Put(1); for (const k in o) sum += o[k]; return sum; });
class Looped { constructor(a) { this.a = a; } m() { return 1; } }
for (const name of ["one", "two"]) Looped.prototype[name] = name;
tell("looped", () => { let sum = 0; const o = new Looped(1); for (const k in o) sum += o[k]; return sum; });
class Defined { constructor(a) { this.a = a; } m() { return 1; } }
Object.defineProperty(Defined.prototype, "shown", { value: "defined", enumerable: true });
Object.defineProperty(Defined.prototype, "got", { get() { return "got" + this.a; }, enumerable: true });
Object.defineProperty(Defined.prototype, "m", { enumerable: true });
tell("defined", () => { let sum = ""; const o = new Defined(1); for (const k in o) sum += k + describe(o[k]); return sum; });
class Below { constructor(a) { this.a = a; } m() { return 1; } }
Object.setPrototypeOf(Below.prototype, { above: "above" });
tell("below", () => { let sum = 0; const o = new Below(1); for (const k in o) sum += o[k]; return sum; });
class Moved { constructor(a) { this.a = a; } m() { return 1; } }
tell("moved", () => { let sum = 0; const o = new Moved(1); Object.setPrototypeOf(o, { moved: "moved" }); for (const k in o) sum += o[k]; return sum; });
class Reflected { constructor(a) { this.a = a; } m() { return 1; } }
Reflect.set(Reflected.prototype, "r", "reflect");
tell("reflected", () => { let sum = 0; const o = new Reflected(1); for (const k in o) sum += o[k]; return sum; });
const addTo = (target, name, value) => { target[name] = value; };
class Helped { constructor(a) { this.a = a; } m() { return 1; } }
addTo(Helped.prototype, "h" + (process.argv[2] || ""), "helped");
tell("helped", () => { let sum = 0; const o = new Helped(1); for (const k in o) sum += o[k]; return sum; });
const proto = (c) => c.prototype;
class Asked { constructor(a) { this.a = a; } m() { return 1; } }
proto(Asked).q = "asked";
tell("asked", () => { let sum = 0; const o = new Asked(1); for (const k in o) sum += o[k]; return sum; });
class Base { constructor(a) { this.a = a; } }
class Heir extends Base { constructor(a) { super(a); this.b = a + 1; } }
tell("heir", () => { let sum = 0; const o = new Heir(1); for (const k in o) sum += o[k]; return sum; });
class Wide extends Base { constructor(a) { super(a); this.w = a; } }
Base.prototype.base = "b";
tell("heir of a changed one", () => { let sum = 0; const o = new Wide(1); for (const k in o) sum += o[k]; return sum; });
class List extends Array { constructor(...a) { super(...a); this.name = "l"; } }
tell("list", () => { let sum = ""; const o = new List("p", "q"); for (const k in o) sum += k + o[k]; return sum; });
class Digits { constructor() { this.a = 1; this[0] = "zero"; } }
tell("digits", () => { let sum = ""; const o = new Digits(); for (const k in o) sum += k + o[k]; return sum; });
const computed = "c" + (process.argv[3] || "");
class Computed { [computed] = 4; d = 5; e() { return 6; } }
tell("computed", () => { let sum = ""; const o = new Computed(); for (const k in o) sum += k + o[k]; return sum; });
class Fields { one = 1; two = "2"; #three = 3; static four = 4; five() { return this.#three; } }
tell("fields", () => { let sum = ""; const o = new Fields(); for (const k in o) sum += k + o[k]; return sum + o.five(); });
class Given { constructor(a) { this.a = a; } }
tell("given", () => { const o = new Given(1); const name = process.argv[4] || "any"; o[name] = "given"; let sum = 0; for (const k in o) sum += o[k]; return sum; });
class Shown { constructor(a) { this.a = a; } }
tell("accessor", () => { const o = new Shown(1); Object.defineProperty(o, "g", { get() { return "own"; }, enumerable: true }); let sum = 0; for (const k in o) sum += o[k]; return sum; });
for (const line of out) console.log(line);
