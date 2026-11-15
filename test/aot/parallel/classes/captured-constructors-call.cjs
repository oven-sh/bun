// Constructor functions that capture objects of the function around them, whose prototypes and instances are changed.
const lines = []; const say = (...v) => lines.push(v.map(x => { try { return typeof x === "function" ? "fn " + x.name : typeof x === "object" && x ? JSON.stringify(x) : String(x); } catch (e) { return e.constructor.name; } }).join(" "));
const attempt = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + String(e.message).split("(")[0]; } say(name, r); };
var lib = (function (exports) { var registry = { made: 0, last: null, kinds: [] }, label = "r", total = 0;
 function Base(pc, px1) { registry.made++; this.c = pc; this.x1 = []; this.size = registry.made; }
 Base.prototype.toString = function (v) { return "T" + this.c; };
 Base.prototype.get = function (v) { return this.c; };
 Base.prototype.run = function (v) { return this.toString ? this.toString() : registry.made; };
 Object.defineProperty(Base.prototype, "acc", { get: function () { return this.c; }, set: function (v) { registry.last = v; }, configurable: true });
 return { Base: Base,  registry: registry, total: function () { return total; } }; }).call(this, {});
const Base = lib.Base;
const makeAll = () => [new Base(0, "q0"), new Base(1, "q1"), new Base()];
let os = makeAll();
function look(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; r += o.c + "," + o.x1 + "," + o.size + "|"; } return r; }
function store(os, v) { for (let i = 0; i < os.length; i++) { os[i].c = v + i; os[i].size = os[i].c; } return look(os); }
function calls(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; try { const v = o.toString(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.get(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.run(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } } return r; }
function one(o) { return String(o.c) + typeof o.toString + (o instanceof Base) + (o.acc === undefined); }
function made(n) { let s = 0; for (let i = 0; i < n; i++) { const o = new Base(i, i + 1); s += o.c === undefined ? 1 : String(o.x1).length; o.c = i; s += o.c; } return s; }
const all = tag => { attempt(tag + " look", () => look(os)); attempt(tag + " calls", () => calls(os)); attempt(tag + " store", () => store(os, 3)); attempt(tag + " one", () => os.map(one).join()); attempt(tag + " made", () => made(6)); attempt(tag + " fresh", () => look(makeAll()) + calls(makeAll())); attempt(tag + " total", () => lib.total() + " " + lib.registry.made + " " + lib.registry.last); };
for (let t = 0; t < 2; t++) all("start" + t);
attempt("change", () => { delete os[0].c; });
all('delete os[0].c;');
attempt("change", () => { Object.freeze(Base.prototype); });
all('Object.freeze(Base.proto');
for (const l of lines) console.log(l);
