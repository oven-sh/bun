// class D extends P, where a variable holds the parent: one class, several, none, and functions on the prototype by an alias.
"use strict";
const out = [];
const say = (name, f) => { try { out.push(name + ": " + JSON.stringify(f())); } catch (e) { out.push(name + ": " + e.constructor.name); } };
class Base { constructor(a) { this.a = a; this.state = { n: a, s: "base" }; } show() { return this.name() + this.a + this.state.n + this.state.s + (this.late ?? "."); } name() { return "b"; } set(n) { this.state.n = n; this.late = n + 1; } static make() { return "Base.make"; } }
class Other { constructor(a) { this.b = a * 3; this.a = "o" + a; this.state = { n: a, s: "other" }; } show() { return "Other" + this.a + this.state.n; } name() { return "o"; } set(n) { this.state.n = n; } }
function Old(a) { this.a = a; this.state = { n: a, s: "old" }; }
Old.prototype.show = function () { return this.name() + this.a + this.state.n; }; Old.prototype.name = function () { return "old"; }; Old.prototype.set = function (n) { this.state.n = n; };
const use = D => { const r = []; for (let i = 0; i < 5; i++) { const d = new D(i); d.set(i * 2); r.push(d.show(), d.own(), Object.keys(d).join(), d instanceof Base, d instanceof Other); } return r; };
let one = {};
{ one = Base; }
{ const P = one; class D extends P { constructor(a) { super(a); this.b = a + 1; } name() { return "d"; } own() { return this.state.n + this.b; } }
  const pp = D.prototype; pp.added = function (n) { this.set(n); return this.show() + this.b + (this.late ?? ""); };
  say("one", () => use(D)); say("static", () => D.make()); say("added", () => { const d = new D(1), r = []; for (let i = 0; i < 40; i++) r.push(d.added(i)); return r.join(""); });
  say("foreign", () => [pp.added.call({ a: 1, b: 2, state: {}, set() { this.late = 5; }, show() { return "f"; } }), Base.prototype.show.call({ name: () => "x", a: 1, state: { n: 2, s: "s" } })]);
  say("missing", () => pp.added.call({}));
  say("own name", () => { const d = new D(1); d.added = () => "mine"; d.name = () => "n"; return [d.added(2), d.show(), delete d.name, d.show()]; });
  say("without a field", () => { const d = new D(1); delete d.state; d.state = { n: 9, s: "again" }; const r = [d.show(), d.added(3)]; Object.defineProperty(d, "state", { get() { return { n: 7, s: "getter" }; } }); return [...r, d.show()]; });
  say("computed", () => { const d = new D(1); for (const k of ["a", "late", "state"]) d[k] = k === "state" ? { n: 1.5, s: "c" } : k; return [d.show(), d.own()]; });
  say("frozen", () => { const d = Object.freeze(new D(3)); try { d.set(8); } catch (e) { return [e.constructor.name, d.show()]; } });
  say("replaced", () => { const d = new D(1), kept = Base.prototype.show; Base.prototype.show = function () { return "replaced" + this.a; }; const r = [d.show(), d.added(1)]; Base.prototype.show = kept; return [...r, d.show()]; });
  say("constructed for another", () => { const d = Reflect.construct(D, [3], Other); return [d instanceof Other, Object.keys(d).join(), d.show()]; });
  say("moved below another", () => { const d = new D(2); Object.setPrototypeOf(D.prototype, Other.prototype); const r = [d.show(), d.added(4)]; Object.setPrototypeOf(D, Other); return [...r, new D(5).show(), Object.keys(new D(6)).join()]; });
}
let first = Other;
first = Base;
{ const P = first; class D extends P { constructor(a) { super(a); this.b = a; } own() { return this.b; } } say("two", () => use(D)); }
let last = Base;
last = Other;
{ const P = last; class D extends P { constructor(a) { super(a); this.c = a; } own() { return this.c + this.b; } } say("the other", () => use(D)); }
var old = null;
old = Old;
{ const P = old; class D extends P { constructor(a) { super(a); this.b = a; } own() { return this.b; } } say("function", () => use(D)); }
let never = {};
say("none", () => { const P = never; class D extends P {} return new D(); });
if (out.length < 0) never = Base;
let unknown = [Base, Other][out.length & 0];
unknown = globalThis.process.argv.length > 99 ? Base : unknown;
{ const P = unknown; class D extends P { constructor(a) { super(a); this.b = a; } own() { return this.b; } } say("unknown", () => use(D)); }
let late = {};
say("before", () => { class D extends late {} return new D(); });
late = Base;
const makers = [() => { class D extends late { constructor(a) { super(a); this.b = a; } own() { return this.b; } } return D; }];
say("made late", () => use(makers[0]()));
late = Other;
say("made again", () => use(makers[0]()));
for (const line of out) console.log(line);
