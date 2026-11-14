// Babel's _callSuper allocates twice for each object: new Heir(), and Reflect.construct(Parent, args, Heir). Both are remembered, until a `prototype` changes.
// COUNTER: CreateThisSlowPaths <= 4000
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
globalThis.pass = (value, to) => to(value);
function Cursor(text) { this.text = text; this.pos = 0; this.kind = new.target ? new.target.name : "none"; }
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) n += this.text.charCodeAt(this.pos++); return n; };
class Counter { constructor(n) { this.count = n; this.kind = new.target.name; } up() { return ++this.count; } }
function inherits(t, e) { t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: true, configurable: true } }); Object.defineProperty(t, "prototype", { writable: false }); e && Object.setPrototypeOf(t, e); }
function callSuper(t, o, e) { o = Object.getPrototypeOf(o); const made = Reflect.construct(o, e || [], Object.getPrototypeOf(t).constructor); if (made && typeof made === "object") return made; throw new TypeError(); }
const make = (Base) => { function Heir(a) { const self = callSuper(this, Heir, [a]); self.extra = 1; return self; } inherits(Heir, Base); Object.defineProperty(Heir.prototype, "more", { value: function () { return this.extra + (this.pos || 0); }, writable: true, configurable: true }); return Heir; };
const First = globalThis.pass(Cursor, make), Second = globalThis.pass(Counter, make), Third = globalThis.pass(First, make);
let total = 0;
for (let i = 0; i < 1500; i++) { const a = new First("ab" + i), b = new Second(i), c = new Third("x" + i); total += a.all() + a.more() + b.up() + b.more() + c.all() + c.more() + new Cursor("q").pos; }
out.push(total);
for (const C of [First, Second, Third]) { const o = new C("xy"); out.push(JSON.stringify(o), Object.keys(o).join(), o instanceof C, o instanceof Cursor, Object.getPrototypeOf(o) === C.prototype, o.constructor === C); }
for (const C of [First, Second, Third]) out.push(show(() => JSON.stringify(Reflect.construct(Cursor, ["r"], C))), show(() => Reflect.construct(Cursor, ["r"], C) instanceof C), show(() => JSON.stringify(Reflect.construct(C, ["s"], Cursor))), show(() => JSON.stringify(Reflect.construct(C, ["s"], Array))));
Object.setPrototypeOf(First, Counter); out.push(show(() => JSON.stringify(new First(5))), show(() => new First(6).up())); Object.setPrototypeOf(First, Cursor);
Object.setPrototypeOf(First.prototype, Counter.prototype); out.push(show(() => new First("z").up()), new First("z") instanceof Cursor); Object.setPrototypeOf(First.prototype, Cursor.prototype);
out.push(new First("za").all(), new Third("zb").all(), new Third("zc").kind);
const old = Cursor.prototype; Cursor.prototype = { all() { return "other"; } }; out.push(new Cursor("a").all(), show(() => new First("a").all()), show(() => JSON.stringify(Reflect.construct(Cursor, ["r"], function Late() {})))); Cursor.prototype = old;
function Late(a) { return callSuper(this, Late, [a]); } inherits(Late, Cursor); out.push(new Late("b").kind, JSON.stringify(new Late("c")));
for (let i = 0; i < 20; i++) { const C = make(i % 2 ? Cursor : Counter); total += JSON.stringify(new C("k" + i)).length + JSON.stringify(new C("m")).length; }
out.push(total);
for (const line of out) console.log(String(line));
