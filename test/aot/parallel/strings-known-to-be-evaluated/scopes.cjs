// this, arguments, new.target, strictness, with, shadowed eval.
const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : typeof x === "symbol" ? String(x) : x));
function sloppy() {
  const f = eval("(function () { return typeof this; })");
  const g = eval("(function () { undeclaredHere = 5; return undeclaredHere; })");
  const a = eval("(function () { arguments[0] = 9; return arguments.length; })");
  const m = eval("(function (x) { arguments[0] = 9; return x; })");
  const n = eval("(function () { return new.target === undefined; })");
  say(f(), f.call(1), g(), a(1, 2), m(1), n(), new n() instanceof n);
  say(typeof undeclaredHere); delete globalThis.undeclaredHere;
}
sloppy();
const ownStrict = eval("(function () { 'use strict'; return this; })");
say(ownStrict());
function shadowed(eval) { return eval("(function () { return 1; })"); }
say(shadowed(t => t.length));
{
  const real = eval;
  let calls = 0;
  globalThis.eval = t => { calls++; return real(t); };
  function replaced() { var local = 3; return eval("(function () { return typeof local; })"); }
  say(replaced()(), calls);
  globalThis.eval = real;
  say(replaced()(), calls);
}
function inWith(o) { with (o) { return eval("(function () { return x; })"); } }
say(inWith({ x: 1 })(), inWith({ x: 2 })());
function block() {
  let r = [];
  for (let i = 0; i < 3; i++) { r.push(eval("(function () { return i++; })")); }
  return r;
}
const fs = block(); say(fs[0](), fs[0](), fs[1](), fs[2](), fs[2]());
function params(a, b = eval("(function () { return a; })")) { a = 7; return b(); }
say(params(1));
function leaks() {
  const before = typeof leaked;
  eval("var leaked = 1");
  const f = eval("(function () { return leaked; })");
  leaked = 4;
  return [before, f()];
}
say(...leaks());
function tdz() { try { return eval("(function () { return later; })")(); } catch (e) { return e.name + e.message; } let later = 1; }
say(tdz());
function tdz2() { const f = eval("(function () { return later; })"); let later = 1; return f(); }
say(tdz2());
class A {
  #p = 5;
  constructor() { this.x = 1; this.made = eval("(function () { return this.x; })"); this.arrow = eval("(() => this.x)"); }
  m() { return eval("(function () { return typeof this; })"); }
  priv() { return eval("(o => o.#p)"); }
  static s() { return eval("(function () { return this === undefined; })"); }
  field = eval("(function () { return 2; })");
}
const a = new A(); say(a.made(), a.arrow.call({ x: 2 }), a.m()(), a.priv()(a), A.s()(), a.field());
class B extends A { constructor() { super(); this.y = eval("(function () { return this instanceof B; })").call(this); } n() { return eval("(() => super.m)")() === A.prototype.m; } }
const b = new B(); say(b.y, b.n());
say(eval("(function () { return typeof module + typeof exports + typeof require + typeof __filename; })")());
say((0, eval)("(function () { return typeof module; })")());
const o = { get list() { o.n = (o.n || 0) + 1; return "(function () { return " + o.n + "; })"; } };
say(eval(o.list)(), eval(o.list)(), eval(o.list)());
say(eval("(function () { return eval('1 + 1'); })")());
say(eval("(function f() { return typeof f; })")(), eval("(function f() { f = 1; return typeof f; })")());
try { say(eval("(function f() { 'use strict'; f = 1; })")()); } catch (e) { say(e.name, e.message); }
