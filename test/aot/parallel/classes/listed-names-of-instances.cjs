// STATISTIC: ListedValuesStoredByName >= 8
// The names that a loop, or Object.keys(), gives of an instance: those of a constructor function's prototype are among them in a loop alone.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const describe = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? "{}" : String(v);

function Point(x, y) { this.x = x; this.y = y; this.next = null; }
Point.prototype.sum = function () { return this.x + this.y; };
Point.prototype.step = function (k) { this.x = (this.x + k) & 1023; if (this.next) this.y = this.next.y; return this; };
Point.prototype.clone = function () { const r = new Point(0, 0); for (const k in this) if (this.hasOwnProperty(k)) r[k] = this[k]; return r; };
function hot(n, make) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const p = make(new Point(i, i + 1)); p.next = i ? list[i - 1] : null; list.push(p); } for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; } return total; }
function own(o) { const r = new Point(0, 0); for (const k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
function notOwn(o) { const r = new Point(0, 0); for (const k in o) { if (!o.hasOwnProperty(k)) continue; r[k] = o[k]; } return r; }
const has = Object.prototype.hasOwnProperty;
function held(o) { const r = new Point(0, 0); for (const k in o) if (has.call(o, k)) r[k] = o[k]; return r; }
function owns(o) { const r = new Point(0, 0); for (const k in o) { if (Object.hasOwn(o, k) && k !== "next") r[k] = o[k]; } return r; }
function keys(o) { const r = new Point(0, 0); for (const k of Object.keys(o)) r[k] = o[k]; return r; }
function each(o) { const r = new Point(0, 0); Object.keys(o).forEach((k) => { r[k] = o[k]; }); return r; }
function entries(o) { const r = new Point(0, 0); for (const [k, v] of Object.entries(o)) r[k] = v; return r; }
function record(o) { const r = {}; for (const k in o) r[k] = o[k]; return r; }
function total(o) { let sum = 0; for (const k in o) if (o.hasOwnProperty(k) && typeof o[k] === "number") sum += o[k]; return sum; }
function totalOfKeys(o) { let sum = 0; for (const k of Object.keys(o)) if (typeof o[k] === "number") sum += o[k]; return sum; }
for (const make of [own, notOwn, held, owns, keys, each, entries, (p) => p.clone()]) {
    tell("hot", () => hot(1000, make));
    tell("copy", () => { const a = new Point(1.5, "t"), b = make(a); return [Object.keys(b), b.sum(), b instanceof Point, b.hasOwnProperty("sum")]; });
    tell("late", () => { const a = new Point(1, 2); a.late = "l"; a.sum = null; const b = make(a); return [Object.entries(b), describe(b.sum)]; });
    tell("deleted", () => { const a = new Point(1, 2); delete a.y; const b = make(a); return [b, String(b.sum())]; });
}
tell("record", () => Object.entries(record(new Point(5, 6))).map(([k, v]) => k + describe(v)));
tell("total", () => [total(new Point(1, 2)), total(new Point(1.5, "a")), totalOfKeys(new Point(3, 4)), totalOfKeys(new Point("b", 2.5))]);

function Copied(v) { this.v = v; this.w = null; }
Copied.prototype.get = function () { return this.v; };
Copied.prototype.kind = "copied";
tell("unguarded", () => { const r = new Copied(0), o = new Copied(7); for (const k in o) r[k] = o[k]; return [Object.entries(r).map(([k, v]) => k + describe(v)), r.get(), r.kind]; });
tell("shadowed", () => { const o = new Copied(8); o.get = () => "own"; o.kind = 5; const r = new Copied(1); for (const k in o) r[k] = o[k]; return [r.get(), r.kind, new Copied(2).get(), new Copied(2).kind]; });
tell("deleted in the loop", () => { const o = new Copied(9); o.get = () => "own"; const r = new Copied(1); for (const k in o) { if (o.hasOwnProperty(k)) { delete o[k]; r[k] = o[k]; } } return [String(r.v), r.get === Copied.prototype.get, describe(r.w)]; });

function Below(a) { Copied.call(this, a); this.b = "b"; }
Below.prototype = Object.create(Copied.prototype);
Below.prototype.constructor = Below;
Below.prototype.more = function () { return this.b; };
tell("below", () => { const o = new Below(3), r = new Below(4); const seen = []; for (const k in o) { seen.push(k); r[k] = o[k]; } return [seen, r.v, r.b, r.more(), r.get(), r.hasOwnProperty("more"), describe(r.constructor)]; });
tell("below own", () => { const o = new Below(3), r = new Copied(4); for (const k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return Object.entries(r); });
tell("below read", () => { let text = ""; const o = new Below(6); for (const k in o) text += k + describe(o[k]); return text; });
function Late(a) { this.a = a; }
Late.prototype.m = function () { return 1; };
tell("late names on a prototype", () => { const o = new Late(1); let text = ""; for (const k in o) text += k + describe(o[k]); Late.prototype.later = "later"; for (const k in o) text += k + describe(o[k]) + typeof o[k]; return text; });
function Defined(a) { this.a = a; }
Object.defineProperty(Defined.prototype, "shown", { value: "defined", enumerable: true });
Object.defineProperty(Defined.prototype, "got", { get() { return "got" + this.a; }, set(v) { this.a = v; }, enumerable: true });
tell("accessor above", () => { const o = new Defined(1), r = new Defined("r"); let text = ""; for (const k in o) { text += k + describe(o[k]); try { r[k] = o[k]; } catch (e) { text += e.name; } } return [text, r.a, Object.keys(r)]; });
function Literal(a) { this.a = a; }
Literal.prototype = { constructor: Literal, m() { return this.a; }, text: "literal" };
tell("literal", () => { const o = new Literal(1), r = new Literal(2); for (const k in o) r[k] = o[k]; return [Object.keys(r), r.m(), r.text]; });
function setUp(o) { o.extra = "extra"; }
function Parent() { this.p = 1; setUp(this); }
function Made(a) { this.a = a; }
Made.prototype = new Parent();
Made.prototype.m = function () { return this.a; };
tell("made of a parent", () => { const o = new Made(1); let sum = ""; for (const k in o) sum += k + describe(o[k]); const r = new Made(5); for (const k in o) r[k] = o[k]; return [sum, Object.keys(r), r.extra]; });
function Computed(a) { this.a = a; }
const name = process.argv[2] || "put";
Computed.prototype[name] = "computed";
tell("computed", () => { let sum = 0; const o = new Computed(1); for (const k in o) sum += o[k]; return sum; });
function Assigned(a) { this.a = a; }
Object.assign(Assigned.prototype, { one: "1", two() { return 2; } });
tell("assigned", () => { let sum = ""; const o = new Assigned(1); for (const k in o) sum += k + describe(o[k]); return sum; });
function Helped(a) { this.a = a; }
const give = (target, key, value) => { target[key] = value; };
give(Helped.prototype, "h" + (process.argv[3] || ""), "helped");
tell("helped", () => { let sum = 0; const o = new Helped(1); for (const k in o) sum += o[k]; return sum; });
function Own(a) { this.a = a; }
Own.prototype.hasOwnProperty = function (k) { return k === "m"; };
Own.prototype.m = "own method";
tell("own test", () => { const o = new Own(1), r = new Own(2); for (const k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return [Object.entries(r), r.a]; });
function Told(a) { this.a = a; }
Told.prototype.m = "told";
tell("other test", () => { let test = (o, k) => k === "m"; const o = new Told(1), r = new Told(2); for (const k in o) if (test(o, k)) r[k] = o[k]; return Object.entries(r); });
tell("test of another", () => { const o = new Told(1), p = { m: 1 }, r = new Told(2); for (const k in o) if (has.call(p, k)) r[k] = o[k]; return Object.entries(r); });
tell("test of another name", () => { const o = new Told(1), r = new Told(2); for (const k in o) if (has.call(o, "a")) r[k] = o[k]; return Object.entries(r); });
let changed = has;
tell("changed test", () => { changed = { call: () => true }; const o = new Told(1), r = new Told(2); for (const k in o) if (changed.call(o, k)) r[k] = o[k]; return Object.entries(r); });
class Es6 { constructor(a, b) { this.a = a; this.b = b; } sum() { return this.a + this.b; } add(k) { this.a = (this.a + k) | 0; return this; } }
tell("class by keys", () => { const l = []; for (let i = 0; i < 4; i++) { const r = new Es6(0, 0), o = new Es6(i, 2); for (const k of Object.keys(o)) r[k] = o[k]; l.push(r); } let t = 0; for (let i = 0; i < 100; i++) t += l[i & 3].add(i).sum(); return t; });
class Shadow { constructor(a) { this.a = a; this.f = this.f.bind(this); } f() { return this.a; } }
tell("bound", () => { const o = new Shadow(4), r = new Shadow(5); Object.keys(o).forEach(function (k) { if (k === "f") delete o.f; r[k] = o[k]; }); return [r.a, r.f(), r.f === Shadow.prototype.f]; });
class Heir extends Es6 { constructor(a) { super(a, "b"); this.c = [a]; } }
tell("heirs", () => [new Heir(1), new Es6(2, 3)].map((o) => { const r = new Heir(0); for (const k of Object.keys(o)) r[k] = o[k]; return [Object.entries(r), r.sum()]; }));
for (const line of out) console.log(line);
