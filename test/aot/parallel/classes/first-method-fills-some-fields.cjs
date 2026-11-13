"use strict";
// Each construction is followed by a call of a method that fills fields. Some programs show the object, read it or stop before that.
const out = [];
const show = (f) => { try { const r = f(); return typeof r === "object" ? JSON.stringify(r, (k, v) => (v === undefined ? "undefined" : typeof v === "number" && v !== v ? "NaN" : v)) : Object.is(r, -0) ? "-0" : String(r); } catch (error) { return error.constructor.name; } };
// All fields are there before anybody reads them.
class Parser {
  parse(tokens) { this.tokens = tokens; this.pos = 0; this.depth = 0; return this.sum(); }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  sum() { let v = this.product(); while (this.peek() === "+") { this.next(); v += this.product(); } return v; }
  product() { let v = this.atom(); while (this.peek() === "*") { this.next(); v *= this.atom(); } return v; }
  atom() { const t = this.next(); if (t === "(") { this.depth++; const v = this.sum(); this.next(); this.depth--; return v; } return +t; }
}
const parse = (text) => { const parser = new Parser(); const value = parser.parse(text.split(" ")); return [value, parser.pos, parser.depth, Object.keys(parser).join()]; };
for (const text of ["1", "1 + 2 * 3", "( 1 + 2 ) * 3", "( ( 4 ) )", "", "x * 2"]) out.push(show(() => parse(text)), show(() => new Parser().parse(text.split(" "))));
// The method reads a field before it fills it.
class Reads { start(n) { this.first = this.second; this.second = n; this.third = this.first === undefined ? 1 : this.first + 1; return this; } }
for (const n of [1, 2.5]) out.push(show(() => { const r = new Reads(); r.start(n); r.start(n); return r; }));
// Some way leaves a field empty.
class Ways { start(n) { this.a = n; if (n > 2) return this; this.b = n; for (let i = 0; i < n; i++) this.c = i; return this; } total() { return this.a + this.b + this.c; } }
for (const n of [0, 1, 3]) out.push(show(() => new Ways().start(n).total()), show(() => Object.keys(new Ways().start(n)).join()));
// The method shows the object before it has filled it.
const seen = [];
class Shows { start(n) { this.a = n; keep(this); this.b = n; return this; } both() { return this.a + this.b; } }
function keep(o) { seen.push(show(() => o.a + "" + o.b + o.both())); }
out.push(show(() => new Shows().start(1).both()));
class Throws { start(n) { this.a = n; if (n === 2) throw new RangeError("two"); this.b = n + 1; return this; } both() { return this.a + this.b; } }
function tryStart(n) { let t; try { t = new Throws(); t.start(n); } catch (error) { return show(() => t.both()) + error.name; } return t.both(); }
for (const n of [1, 2, 3]) out.push(show(() => tryStart(n)), show(() => { const t = new Throws(); t.start(n); return t.both(); }));
// Another construction is not followed by the method.
class Two { start(n) { this.n = n; return this; } next() { return this.n++; } }
out.push(show(() => { const t = new Two(); t.start(1); return t.next() + t.next(); }), show(() => { const t = new Two(); return [t.next(), t.n, Object.keys(t).join()]; }));
class Clone { start(n) { this.n = n; this.m = 1; return this; } copy() { const c = new Clone(); for (const key in this) c[key] = this[key]; return c; } next() { return this.n++ + this.m; } }
out.push(show(() => { const c = new Clone(); c.start(3); const d = c.copy(); c.next(); return [c.next(), d.next(), Object.keys(d).join(), new Clone().copy().next()]; }));
// The constructor shows the object, or calls the method itself.
class Listed { constructor(list) { list.push(this); } start(n) { this.n = n; return this; } twice() { return this.n * 2; } }
out.push(show(() => { const list = []; const l = new Listed(list); const before = list[0].twice(); l.start(4); return [before, l.twice()]; }));
class Resets { constructor() { this.reset(); } reset() { this.n = 0; return this; } step() { return ++this.n; } }
out.push(show(() => { const r = new Resets(); r.reset(); return [r.step(), r.step(), r.reset().step()]; }));
// Heirs: their constructors run the base's, and their methods stand over its methods.
class Base { start(n) { this.n = n; return this; } get() { return this.n + 1; } }
class Heir extends Base { start(n) { this.m = n; return n > 1 ? super.start(n) : this; } }
out.push(show(() => { const b = new Base(); b.start(1); return b.get(); }), show(() => { const h = new Heir(); h.start(1); return [h.get(), h.m]; }), show(() => { const h = new Heir(); h.start(2); return [h.get(), h.m]; }));
// The method of one class is called on the objects of another; the constructor is handed on; the prototype changes.
class Lent { start(n) { this.n = n; return this; } get() { return this.n + 1; } }
out.push(show(() => { const l = new Lent(); l.start(1); return [l.get(), Lent.prototype.get.call({ n: 5 }), Lent.prototype.get.call(Object.create(Lent.prototype))]; }));
class Handed { start(n) { this.n = n; return this; } get() { return this.n + 1; } }
const make = (Class, n) => { const o = new Class(); if (n) o.start(n); return o; };
out.push(show(() => { const h = new Handed(); h.start(1); return [h.get(), make(Handed, 2).get(), make(Handed, 0).get()]; }));
class Late { start(n) { this.n = n; return this; } get() { return this.n + 1; } }
out.push(show(() => { const l = new Late(); l.start(1); return l.get(); }));
Late.prototype.start = function () { return this; };
out.push(show(() => { const l = new Late(); l.start(1); return l.get(); }));
Object.defineProperty(Late.prototype, "n", { get() { return 40; }, set(v) { seen.push("set" + v); }, configurable: true });
Late.prototype.start = function (n) { this.n = n; return this; };
out.push(show(() => { const l = new Late(); l.start(1); return [l.get(), Object.keys(l).join()]; }));
// Generators and async functions between the construction and the call.
class Held { start(n) { this.n = n; return this; } get() { return this.n + 1; } }
function* steps() { const h = new Held(); yield 1; h.start(2); yield h.get(); }
out.push(show(() => [...steps()]));
class Reflected { start(n) { this.n = n; return this; } get() { return this.n + 1; } }
out.push(show(() => { const r = new Reflected(); r.start(1); return [r.get(), Reflect.construct(Reflected, []).get(), new (Reflected.bind(null))().get()]; }));
function Old() { if (!(this instanceof Old)) return new Old(); }
Old.prototype.start = function (n) { this.n = n; return this; };
Old.prototype.get = function () { return this.n + 1; };
out.push(show(() => { const o = new Old(); o.start(1); return [o.get(), Old().get()]; }));
function Scanner() {}
Scanner.prototype.setInput = function (s) { this.s = s; this.i = 0; this.line = 1; return this; };
Scanner.prototype.run = function () { let t = 0; while (this.i < this.s.length) { const c = this.s.charCodeAt(this.i++); if (c === 10) this.line++; t += c; } return [t, this.i, this.line]; };
for (const text of ["", "ab\nc"]) out.push(show(() => { const s = new Scanner(); s.setInput(text); return s.run(); }));
for (const line of out) console.log(line);
console.log(seen.join());
