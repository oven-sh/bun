// Constructor functions that capture objects of the function around them, whose prototypes and instances are changed.
"use strict";
const lines = []; const say = (...v) => lines.push(v.map(x => { try { return typeof x === "function" ? "fn " + x.name : typeof x === "object" && x ? JSON.stringify(x) : String(x); } catch (e) { return e.constructor.name; } }).join(" "));
const attempt = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + String(e.message).split("(")[0]; } say(name, r); };
var make = function (exports) { var registry = { made: 0, last: null, kinds: [] }, label = "r", total = 0;
 function Base(pa, pb) { registry.made++; this.a = undefined; this.b = []; }
 Base.prototype.put = function (v) { this.b = v; registry.last = v; return this; };
 Base.prototype.get = function (v) { return this.a; };
 Object.defineProperty(Base.prototype, "acc", { get: function () { return this.a; }, set: function (v) { registry.last = v; }, configurable: true });
 function inherits(t, n) { t.prototype = Object.create(n.prototype); t.prototype.constructor = t; }
 function Sub(p, q) { var self = Base.call(this, p, q) || this; self.own = 1; registry.kinds.push(p); return self; }
 inherits(Sub, Base);
 Sub.prototype.get = function (v) { return "S" + registry.kinds.length + label; };
 return { Base: Base, Sub: Sub, registry: registry, total: function () { return total; } }; }; var lib = make({}); var lib2 = make({});
const Base = lib.Base, Sub = lib.Sub;
const makeAll = () => [new Base(0, "q0"), new Base(1, "q1"), new Sub("s", 5), new Sub(7), new lib2.Base(9, 8), ({ a: 5 })];
let os = makeAll();
function look(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; r += o.a + "," + o.b + "|"; } return r; }
function store(os, v) { for (let i = 0; i < os.length; i++) { os[i].a = v + i; os[i].b = os[i].a; } return look(os); }
function calls(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; try { const v = o.put(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.get(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.more(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } } return r; }
function one(o) { return String(o.a) + typeof o.put + (o instanceof Base) + (o.acc === undefined); }
function made(n) { let s = 0; for (let i = 0; i < n; i++) { const o = new Base(i, i + 1); s += o.a === undefined ? 1 : String(o.b).length; o.a = i; s += o.a; } return s; }
const all = tag => { attempt(tag + " look", () => look(os)); attempt(tag + " calls", () => calls(os)); attempt(tag + " store", () => store(os, 3)); attempt(tag + " one", () => os.map(one).join()); attempt(tag + " made", () => made(6)); attempt(tag + " fresh", () => look(makeAll()) + calls(makeAll())); attempt(tag + " total", () => lib.total() + " " + lib.registry.made + " " + lib.registry.last); };
for (let t = 0; t < 2; t++) all("start" + t);
attempt("change", () => { delete Base.prototype.put; });
all('delete Base.prototype.pu');
attempt("change", () => { Object.freeze(os[0]); });
all('Object.freeze(os[0]);');
attempt("change", () => { Object.setPrototypeOf(os[1], null); });
all('Object.setPrototypeOf(os');
attempt("change", () => { os = makeAll(); });
all('os = makeAll();');
attempt("change", () => { Object.defineProperty(Base.prototype, "put", { get() { return () => "got"; }, configurable: true }); });
all('Object.defineProperty(Ba');
for (const l of lines) console.log(l);
