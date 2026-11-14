// Constructors and methods in iterations copy fields of another object into a fresh one: the other is of another class, has accessors, throws; the fresh one has setters and read-only names above it, is published in the middle.
"use strict";
const out = [];
let n = 0;
class Place { constructor(a, b) { this.a = a; this.b = b; } }
class Source { init(v) { this.type = v; this.value = v + 1; this.start = null; this.end = "t"; this.flag = 0.5; this.loc = [v]; return this; } }
class Copy { constructor(s, i) { this.type = s.type; this.value = s.value; this.start = s.start; this.end = s.end; this.flag = i; this.loc = new Place(s.loc, s.flag); } }
class Early { constructor(s) { this.type = s.type; globalThis.last = this; this.value = s.value; if (s.start === 3) return; this.start = s.start; this.type = s.end; } }
class Heir extends Copy { constructor(s, i) { super(s, i); this.more = s.type; } }
class Holder {
  constructor(s) { this.state = s; this.list = []; }
  next(i) { this.list.push(new Copy(this.state, i)); return this.list[this.list.length - 1]; }
  early() { return new Early(this.state); }
  heir(i) { return new Heir(this.state, i); }
  local(i) { const o = new Place(this.state.type, i); o.b = this.state.value; o.c = this.state.end; return o; }
  literal() { const s = this.state; return { a: s.type, b: s.value, c: s.loc }; }
  all(m) { for (let i = 0; i < m; i++) { this.next(i); this.heir(i); this.local(i); this.literal(); this.early(); } return this.list.length; }
}
globalThis.kept = [Source, Copy, Heir, Holder, Place, Early];
if (process.argv[9]) { new Source()[process.argv[9]] = 2; new Holder()[process.argv[9]] = 3; }
const text = (v, d = 0) => typeof v === "function" ? "fn" : v === null || typeof v !== "object" ? typeof v + String(v) : d > 2 ? "deep" : (v instanceof Copy ? "C" : "") + "{" + Object.getOwnPropertyNames(v).map((k) => { const p = Object.getOwnPropertyDescriptor(v, k); return k + (p.writable ? "" : "!") + (p.enumerable ? "" : "?") + ":" + ("value" in p ? text(p.value, d + 1) : "get"); }).join() + "}";
const show = (name, f) => { let q; try { q = text(f()); } catch (e) { q = e.constructor.name; } out.push(name + " " + q); };
let h;
const fresh = (k) => { h = new Holder(new Source().init(k)); return 1; };
const each = (t) => { show(t + "n", () => h.next(1)); show(t + "y", () => h.early()); show(t + "h", () => h.heir(2)); show(t + "l", () => h.local(3)); show(t + "t", () => h.literal()); show(t + "a", () => h.all(6)); };
for (let k = 0; k < 4; k++) { fresh(k); each("k" + k); }
function Other() {}
Other.prototype = { set end(v) { this.o = v; } };
show("target", () => Reflect.construct(Copy, [h.state, 1], Other));
show("bare", () => Reflect.construct(Copy, [h.state, 1], Object));
show("none", () => new Copy());
show("self", () => { const o = { loc: 1 }; o.type = o; o.value = 1; return new Copy(o, 2); });
show("change1", () => { Object.defineProperty(h.state, "type", { get() { return "got" + n++; }, set(v) { }, configurable: true, enumerable: true }); return 1; }); each("c1"); fresh(1);
show("change2", () => { h.state = { type: 1, value: 2, start: 3 }; return 1; }); each("c2");
show("change3", () => { h.state = null; return 1; }); each("c3"); fresh(3);
show("change4", () => { h.state = 5; return 1; }); each("c4");
show("change5", () => { Object.freeze(h.state); return 1; }); each("c5"); fresh(5);
show("change6", () => { delete h.state.start; return 1; }); each("c6");
show("change7", () => { delete h.state.value; return 1; }); each("c7"); fresh(7);
show("change8", () => { Object.defineProperty(Copy.prototype, "value", { set(v) { this.through = v; }, get() { return "up"; }, configurable: true }); return 1; }); each("c8");
show("change9", () => { delete Copy.prototype.value; return 1; }); each("c9"); fresh(9);
show("change10", () => { Object.defineProperty(Copy.prototype, "start", { value: 1, writable: false, configurable: true }); return 1; }); each("c10");
show("change11", () => { delete Copy.prototype.start; return 1; }); each("c11"); fresh(11);
show("change12", () => { Object.defineProperty(h.state, "end", { get() { Object.defineProperty(Copy.prototype, "flag", { set(v) { this.late = v; }, configurable: true }); return 1; }, configurable: true, enumerable: true }); return 1; }); each("c12");
show("change13", () => { delete Copy.prototype.flag; return 1; }); each("c13"); fresh(13);
show("change14", () => { Object.setPrototypeOf(Copy.prototype, { set type(v) { this.above = v; } }); return 1; }); each("c14");
show("change15", () => { Object.setPrototypeOf(Copy.prototype, Object.prototype); return 1; }); each("c15"); fresh(15);
show("change16", () => { Object.freeze(Copy.prototype); return 1; }); each("c16");
show("change17", () => { h.state = new Proxy(h.state, { get(t, k) { n++; return t[k]; } }); return 1; }); each("c17"); fresh(17);
show("change18", () => { h.state = new Copy(h.state, 1); return 1; }); each("c18");
show("change19", () => { h.state = h; return 1; }); each("c19"); fresh(19);
show("change20", () => { Object.defineProperty(h.state, "value", { get() { throw new RangeError("v"); }, configurable: true, enumerable: true }); return 1; }); each("c20");
show("change21", () => { Source.prototype.flag = "above"; delete h.state.flag; return 1; }); each("c21"); fresh(21);
show("change22", () => { delete Source.prototype.flag; return 1; }); each("c22");
show("change23", () => { Object.defineProperty(h.state, "start", { get() { const c = globalThis.last; if (c) c.type = "changed"; return 8; }, configurable: true, enumerable: true }); return 1; }); each("c23"); fresh(23);
show("change24", () => { globalThis.last = undefined; return 1; }); each("c24");
for (const line of out) console.log(line);
console.log(n);
