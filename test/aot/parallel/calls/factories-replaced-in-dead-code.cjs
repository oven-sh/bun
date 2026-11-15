// Two factories are written at one place, one of them in code that never runs or in a declaration that another one replaces. A call makes what the one makes that the program calls.
const kit = {}, names = [];
const show = (...made) => names.push(made.map(it => new it("x").tag() + ":" + Object.getPrototypeOf(it).name).join());
kit.ifFalse = function (Base) { return class extends Base { tag() { return "ifFalse"; } }; };
if (false) kit.ifFalse = function (Base) { return class extends Base { tag() { return "no"; } }; };
const a = kit.ifFalse(Object), b = kit.ifFalse(Array); show(a, b);
const DEBUG = false;
kit.constant = Base => class extends Base { tag() { return "constant"; } };
if (DEBUG) kit.constant = Base => class extends Base { tag() { return "no"; } };
const c = kit.constant(Object), d = kit.constant(Array); show(c, d);
kit.uncalled = function (Base) { return class extends Base { tag() { return "uncalled"; } }; };
function never(word) { const local = word + 1; kit.uncalled = function (Base) { return class extends Base { #own = 1; static all = [1]; tag() { return "no" + this.#own; } }; }; return local; }
const e = kit.uncalled(Object), f = kit.uncalled(Array); show(e, f);
const tools = { get never() { kit.getter = Base => class extends Base {}; return 1; }, never2() { kit.getter = Base => class extends Base {}; } };
kit.getter = function (Base) { return class extends Base { tag() { return "getter"; } }; };
const g = kit.getter(Object), h = kit.getter(Array); show(g, h);
kit.afterReturn = function (Base) { return class extends Base { tag() { return "afterReturn"; } }; };
(function () { return; kit.afterReturn = function (Base) { return class extends Base { tag() { return "no"; } }; }; })();
const i = kit.afterReturn(Object), j = kit.afterReturn(Array); show(i, j);
kit.afterThrow = function (Base) { return class extends Base { tag() { return "afterThrow"; } }; };
try { throw 1; kit.afterThrow = function (Base) { return class extends Base { tag() { return "no"; } }; }; } catch {}
const k = kit.afterThrow(Object), l = kit.afterThrow(Array); show(k, l);
kit.branch = function (Base) { return class extends Base { tag() { return "branch"; } }; };
switch (1) { case 1: break; default: kit.branch = function (Base) { return class extends Base { tag() { return "no"; } }; }; }
while (false) { kit.branch = function (Base) { return class extends Base { tag() { return "no"; } }; }; }
false && (kit.branch = function (Base) { return class extends Base { tag() { return "no"; } }; });
true ? 0 : (kit.branch = function (Base) { return class extends Base { tag() { return "no"; } }; });
null?.take(kit.branch = function (Base) { return class extends Base { tag() { return "no"; } }; });
const m = kit.branch(Object), n = kit.branch(Array); show(m, n);
const makers = [function (Base) { return class extends Base { tag() { return "unknown"; } }; }];
kit.unknown = makers[process.argv.length > 0 ? 0 : 1];
(function () { return; kit.unknown = function (Base) { const seen = new Map(); return class Made extends Base { #own = 1; static all = [1]; static { this.all.push(2); } *[Symbol.iterator]() { yield this.#own; } async go() { await null; return seen; } ["tag"]() { return "no"; } }; }; })();
const o = kit.unknown(Object), p = kit.unknown(Array); show(o, p);
if (false) kit.alone = function (Base) { return class extends Base { tag() { return "no"; } }; };
try { const q = kit.alone(Object), r = kit.alone(Array); show(q, r); } catch (error) { names.push(error.name); }
let literal = { sub(Base) { return class extends Base { tag() { return "literal"; } }; } };
if (false) literal = { sub(Base) { return class extends Base { tag() { return "no"; } }; } };
const s = literal.sub(Object), t = literal.sub(Array); show(s, t);
(function () {
  "use strict";
  function declared(Base) { return class extends Base { tag() { return "no"; } }; }
  function declared(Base) { return Base; }
  const u = declared(Object), v = declared(Array); names.push((u === Object) + "/" + (v === Array));
  function twice(Base) { return class extends Base { tag() { return "no"; } }; }
  const w = twice(Object), x = twice(Array);
  function twice(Base) { return class extends Base { tag() { return "twice"; } }; }
  show(w, x);
  function replaced(Base) { return class extends Base { tag() { return "replaced"; } }; }
  if (false) replaced = function (Base) { return class extends Base { tag() { return "no"; } }; };
  const y = replaced(Object), z = replaced(Array); show(y, z);
})();
kit.between = function (kind) { function Shape(x) { this.x = x; } Shape.prototype.tag = function () { return "first" + kind + this.x; }; return Shape; };
const One = kit.between("1"), Two = kit.between("2");
kit.between = function (kind) { function Shape(x, y) { this.y = y; this.x = x; } Shape.prototype.tag = function () { return "second" + kind + this.x; }; return Shape; };
const Three = kit.between("3"), Four = kit.between(4); show(One, Two, Three, Four);
kit.range = function (low, high) { return function (c) { return c >= low && c <= high; }; };
function narrow() { kit.range = function (low, high) { return function (c) { return c > low && c < high; }; }; }
const digit = kit.range(48, 57);
if (process.argv.length > 0) narrow();
const letter = kit.range(97, 122);
let found = 0;
for (let code = 0; code < 128; code++) { if (digit(code)) found += 1; if (letter(code)) found += 100; }
console.log(names.join("\n"), found, kit.uncalled.name, kit.ifFalse.name, literal.sub.name);
