// Constructor functions that capture objects of the function around them, whose prototypes and instances are changed.
const lines = []; const say = (...v) => lines.push(v.map(x => { try { return typeof x === "function" ? "fn " + x.name : typeof x === "object" && x ? JSON.stringify(x) : String(x); } catch (e) { return e.constructor.name; } }).join(" "));
const attempt = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + String(e.message).split("(")[0]; } say(name, r); };
var lib; !function (t, n) { process.argv.length > 50 ? lib = n(t) : "function" == typeof nothere ? lib = n({}) : lib = n(t = {}); }(this, function (exports) { var registry = { made: 0, last: null, kinds: [] }, label = "r", total = 0;
 function Base(px1, pc) { registry.made++; this.x1 = "s"; this.c = registry.made; }
 Base.prototype.run = function (v) { return this.run ? this.get() : registry.made; };
 Base.prototype.put = function (v) { this.c = v; registry.last = v; return this; };
 Base.prototype.add = function (v) { total += 1; return String(this.x1) + label + total; };
 function inherits(t, n) { t.prototype = Object.create(n.prototype); t.prototype.constructor = t; }
 function Sub(p, q) { var self = Base.call(this, p, q) || this; self.x1 = 1; registry.kinds.push(p); return self; }
 inherits(Sub, Base);
 Sub.prototype.run = function (v) { return "S" + registry.kinds.length + this.x1; };
 return { Base: Base, Sub: Sub, registry: registry, total: function () { return total; } }; });
const Base = lib.Base, Sub = lib.Sub;
const makeAll = () => [new Base(0, "q0"), new Base(1, "q1"), new Sub("s", 5), new Sub(7), Object.create(Base.prototype)];
let os = makeAll();
function look(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; r += o.x1 + "," + o.c + "|"; } return r; }
function store(os, v) { for (let i = 0; i < os.length; i++) { os[i].x1 = v + i; os[i].c = os[i].x1; } return look(os); }
function calls(os) { let r = ""; for (let i = 0; i < os.length; i++) { const o = os[i]; try { const v = o.run(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.put(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.add(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } try { const v = o.more(i); r += (typeof v === "object" ? "o" : String(v)) + ";"; } catch (e) { r += e.constructor.name + ";"; } } return r; }
function one(o) { return String(o.x1) + typeof o.run + (o instanceof Base) + (o.acc === undefined); }
function made(n) { let s = 0; for (let i = 0; i < n; i++) { const o = new Base(i, i + 1); s += o.x1 === undefined ? 1 : String(o.c).length; o.x1 = i; s += o.x1; } return s; }
const all = tag => { attempt(tag + " look", () => look(os)); attempt(tag + " calls", () => calls(os)); attempt(tag + " store", () => store(os, 3)); attempt(tag + " one", () => os.map(one).join()); attempt(tag + " made", () => made(6)); attempt(tag + " fresh", () => look(makeAll()) + calls(makeAll())); attempt(tag + " total", () => lib.total() + " " + lib.registry.made + " " + lib.registry.last); };
for (let t = 0; t < 2; t++) all("start" + t);
attempt("change", () => { Base.prototype.run = function () { return "new"; }; });
all('Base.prototype.run = fun');
attempt("change", () => { attempt("called", () => Base.call({}, 1, 2)); });
all('attempt("called", () => ');
attempt("change", () => { os.push(new Base({}, [])); });
all('os.push(new Base({}, [])');
for (const l of lines) console.log(l);
