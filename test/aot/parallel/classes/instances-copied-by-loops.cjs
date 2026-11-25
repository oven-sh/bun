// STATISTIC: InstancesCopiedByLoops >= 4
// `for (const k in o) r[k] = o[k]` gives each field of `r` what the field of `o` under its name holds.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const describe = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? "{}" : String(v);
class Point { constructor(x, y) { this.x = x; this.y = y; this.next = null; } sum() { return this.x + this.y; } step(k) { this.x = (this.x + k) & 1023; if (this.next) this.y = this.next.y; return this; } get double() { return this.x * 2; } clone() { const r = new Point(0, 0); for (const k in this) r[k] = this[k]; return r; } }
function copy(o) { const r = new Point(0, 0); for (const k in o) r[k] = o[k]; return r; }
function own(o) { const r = new Point(0, 0); for (const k in o) { if (o.hasOwnProperty(k)) r[k] = o[k]; } return r; }
function record(o) { const r = { x: "old" }; for (const k in o) r[k] = o[k]; return r; }
function hot(n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const p = copy(new Point(i, i + 1)); p.next = i ? list[i - 1] : null; list.push(own(p)); } for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; } return total; }
tell("hot", () => hot(1000));
tell("copy", () => { const a = new Point(1, 2); a.next = new Point(3, 4); const b = copy(a); b.x = 9; return [a, b, b.next === a.next, b.double, Object.keys(b)]; });
tell("clone", () => { const a = new Point(1.5, "t"); const b = a.clone(); return [b, b.sum(), b instanceof Point]; });
tell("record", () => record(new Point(5, 6)));
tell("late", () => { const a = new Point(1, 2); a.late = "l"; return [Object.entries(copy(a)), Object.entries(own(a))]; });
tell("deleted", () => { const a = new Point(1, 2); delete a.y; const b = copy(a); return [b, String(b.sum())]; });
tell("part", () => { const a = new Point(1, 2), r = new Point(7, 8); for (const k in a) if (k !== "y") r[k] = a[k]; return r; });
class Other { constructor(v) { this.x = "o" + v; this.y = null; this.z = [v]; } sum() { return this.x; } }
tell("other class", () => { const r = new Point(1, 2), o = new Other(3); for (const k in o) r[k] = o[k]; return [r, String(r.sum()), Object.keys(r)]; });
tell("either class", () => [new Point(1, 2), new Other(4)].map((o) => { const r = new Other(0); for (const k in o) r[k] = o[k]; return r; }));
class Base { constructor(a) { this.a = a; } }
class Heir extends Base { constructor(a) { super(a); this.b = a + 1; } total() { return this.a + this.b; } }
tell("heir", () => { const o = new Heir(1), r = new Heir(5); for (const k in o) r[k] = o[k]; return [r, r.total()]; });
tell("heir into base", () => { const o = new Heir(1), r = new Base(5); for (const k in o) r[k] = o[k]; return Object.entries(r); });
tell("frozen", () => { const r = Object.freeze(new Base(1)); const o = new Base(2); for (const k in o) r[k] = o[k]; return r; });
class Setter { constructor() { this.n = 0; } set a(v) { this.n += v; } get a() { return -1; } }
tell("setter", () => { const r = new Setter(), o = new Base(4); for (const k in o) r[k] = o[k]; return [r, r.a]; });
class Mixed { constructor(a) { this.a = a; } m() { return 1; } }
Object.assign(Mixed.prototype, { extra: "mixed" });
tell("assigned", () => { const o = new Mixed(1), r = new Mixed(2); for (const k in o) r[k] = o[k]; return Object.entries(r); });
class Put { constructor(a) { this.a = a; } m() { return 1; } }
Put.prototype.m2 = function () { return 2; };
tell("put", () => { const o = new Put(1), r = new Put(2); for (const k in o) r[k] = o[k]; return Object.keys(r).map((k) => k + describe(r[k])); });
class Below { constructor(a) { this.a = a; } }
Object.setPrototypeOf(Below.prototype, { above: "above" });
tell("below", () => { const o = new Below(1), r = new Base(2); for (const k in o) r[k] = o[k]; return Object.entries(r); });
class Moved { constructor(a) { this.a = a; } }
class Into { constructor(a) { this.a = a; } }
tell("moved", () => { const o = new Moved(1), r = new Into(2); Object.setPrototypeOf(o, { a: "x", moved: "m" }); for (const k in o) r[k] = o[k]; return Object.entries(r); });
class Got { constructor(a) { this.a = a; } }
class Takes { constructor(a) { this.a = a; } }
tell("accessor", () => { const o = new Got(1), r = new Takes(2); Object.defineProperty(o, "a", { get() { return "got"; }, enumerable: true }); Object.defineProperty(o, "g", { get() { return "g"; }, enumerable: true }); for (const k in o) r[k] = o[k]; return Object.entries(r); });
class Named { constructor(a) { this.a = a; } }
class Receives { constructor(a) { this.a = a; } sum() { return this.a + 1; } }
tell("unknown name", () => { const o = new Named(1), r = new Receives(2); o[process.argv[2] || "any"] = "given"; o[process.argv[3] || "a"] = "text"; for (const k in o) r[k] = o[k]; return [Object.entries(r), r.sum()]; });
class Seen { constructor(a) { this.a = a; } }
class Sees { constructor(a) { this.a = a; } sum() { return this.a + 1; } }
globalThis.seen = new Seen(1);
tell("seen by others", () => { const name = process.argv[4] || "seen"; globalThis[name].a = "global"; globalThis[name].more = 1; const o = globalThis.seen, r = new Sees(2); for (const k in o) r[k] = o[k]; return [Object.entries(r), r.sum()]; });
tell("proto name", () => { const o = new Named(1), r = new Receives(2); Object.defineProperty(o, "__proto__", { value: { up: 1 }, enumerable: true }); for (const k in o) r[k] = o[k]; return [Object.keys(r), r.up, r instanceof Receives]; });
for (const line of out) console.log(line);
