// Constructor functions that capture objects of the function around them, whose prototypes and instances are changed.
"use strict";
const lines = []; const say = (...v) => lines.push(v.map(x => { try { return typeof x === "function" ? "fn " + x.name : typeof x === "object" && x ? JSON.stringify(x) : String(x); } catch (e) { return e.constructor.name; } }).join(" "));
const attempt = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + String(e.message).split("(")[0]; } say(name, r); };
var lib; !function (n) { try { lib = n(null); if (true) throw 1; } catch (e) { lib = n({}); } }(function (exports) { var registry = { made: 0, last: null, kinds: [] }, label = "r", total = 0;
 function Base(pc, pd) { registry.made++; this.c = "s"; this.d = registry.made; this.x1 = []; this.a = "s"; }
 var proto = Base.prototype;
 proto.toString = function (v) { return "T" + this.c; };
 proto.add = function (v) { total += 1; return String(this.c) + label + total; };
 proto.run = function (v) { return this.toString ? this.toString() : registry.made; };
 proto.put = function (v) { this.a = v; registry.last = v; return this; };
 function inherits(t, n) { t.prototype = Object.create(n.prototype); t.prototype.constructor = t; }
 function Sub(p, q) { var self = Base.call(this, p, q) || this; self.own = label; registry.kinds.push(p); return self; }
 Object.setPrototypeOf(Sub.prototype, Base.prototype); Object.setPrototypeOf(Sub, Base);
 Sub.prototype.toString = function (v) { return "S" + registry.kinds.length + label; };
 return { Base: Base, Sub: Sub, registry: registry, total: function () { return total; } }; });
const Base = lib.Base, Sub = lib.Sub;
const makeAll = () => [new Base(0, "q0"), new Base(1, "q1"), new Sub("s", 5), new Sub(7)];
let os = makeAll();
function look(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; r += o.c + "," + o.d + "," + o.x1 + "," + o.a + "|"; } return r; }
function store(os, v) { for (let i = 0; i < os.length; i++) { os[i].c = v + i; os[i].a = os[i].c; } return look(os); }
function calls(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; try { const v = o.toString(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.add(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.run(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.put(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.more(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } } return r; }
function one(o) { return String(o.c) + typeof o.toString + (o instanceof Base) + (o.acc === undefined); }
function made(n) { let s = 0; for (let i = 0; i < n; i++) { const o = new Base(i, i + 1); s += o.c === undefined ? 1 : String(o.d).length; o.c = i; s += o.c; } return s; }
const all = tag => { attempt(tag + " look", () => look(os)); attempt(tag + " calls", () => calls(os)); attempt(tag + " store", () => store(os, 3)); attempt(tag + " one", () => os.map(one).join()); attempt(tag + " made", () => made(6)); attempt(tag + " fresh", () => look(makeAll()) + calls(makeAll())); attempt(tag + " total", () => lib.total() + " " + lib.registry.made + " " + lib.registry.last); };
for (let t = 0; t < 2; t++) all("start" + t);
attempt("change", () => { lib.registry.made = "x"; });
all('lib.registry.made = "x";');
attempt("change", () => { delete Base.prototype.toString; });
all('delete Base.prototype.to');
attempt("change", () => { Base.prototype.toString = function () { return "new"; }; });
all('Base.prototype.toString ');
attempt("change", () => { os[0].a = 1; os[1].a = 2; });
all('os[0].a = 1; os[1].a = 2');
for (const l of lines) console.log(l);
