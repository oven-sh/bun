// A bind of a plain function that the compiler sees: called, constructed, tested, looked at, bound again, extended.
const lines = [];
const say = (...parts) => lines.push(parts.map(part => (typeof part === "function" ? "function " + part.name : String(part))).join(" "));
function Point(x, y) { if (new.target) { this.x = x; this.y = y; this.made = new.target === Point ? "Point" : new.target.name; } else return "called " + x + " " + y; }
Point.prototype.sum = function () { return this.x + this.y; };
function usesThis(a) { return this === undefined ? "undefined " + a : this === null ? "null " + a : typeof this + " " + (this.tag ?? "-") + " " + a; }
function strictThis(a) { "use strict"; return this === undefined ? "undefined " + a : this === null ? "null " + a : typeof this + " " + a; }
function five(a, b, c, d, e) { return [a, b, c, d, e].join(","); }
function returnsObject(a) { return { a }; }
function counter() { let n = 0; function next(step) { if (new.target) this.n = n; n += step; return n; } return next; }
function make() {
  const one = Point.bind(null, 1);
  say("call", one(2), one());
  const p = new one(2);
  say("new", p.x, p.y, p.made, p.sum(), p instanceof Point, p instanceof one, Object.getPrototypeOf(p) === Point.prototype, p.constructor === Point);
  const both = Point.bind({ ignored: true }, 3, 4);
  const q = new both(5);
  say("new with all bound", q.x, q.y, q.made, q instanceof both);
  say("names", one.name, one.length, both.name, both.length, typeof one, Object.prototype.toString.call(one));
  say("prototype", "prototype" in one, one.prototype, Object.getOwnPropertyNames(one).sort().join(), Object.getPrototypeOf(one) === Function.prototype);
  say("text", String(one).replace(/\s+/g, " "));
  try { class Derived extends one { constructor() { super(7); this.extra = 1; } } const d = new Derived(); say("extends", d.x, d.y, d.made, d.extra, d instanceof Derived, d instanceof Point); } catch (e) { say("extends throws", e.constructor.name); }
  const withPrototype = Point.bind(null, 1); withPrototype.prototype = Point.prototype;
  class Heir extends withPrototype { constructor() { super(7); this.extra = 1; } }
  const h = new Heir(); say("extends with a prototype of its own", h.x, h.y, h.made, h.extra, h instanceof Heir, h instanceof Point, h.sum());
  function Other() {} Other.prototype.mark = "other";
  const r = Reflect.construct(one, [8], Other);
  say("Reflect.construct", r.x, r.y, r.made, r.mark, r instanceof Point, r instanceof Other);
  const r2 = Reflect.construct(one, [9], one);
  say("new.target is the bound function", r2.made, r2 instanceof Point);
  const again = one.bind(null, 10);
  const s = new again();
  say("bound again", again.name, again.length, again(), s.x, s.y, s.made, s instanceof Point);
  say("this", usesThis.bind({ tag: "t" }, 1)(), usesThis.bind(null, 2)() === usesThis.call(null, 2), usesThis.bind(5, 3)(), strictThis.bind(null, 4)(), strictThis.bind(undefined, 5)(), strictThis.bind(6, 7)());
  say("many", five.bind(null, 1, 2, 3, 4)(5), five.bind(null, 1, 2, 3, 4, 5, 6, 7)(8), five.bind(null)(1), five.bind()(1, 2));
  say("new returns an object", new (returnsObject.bind(null, 1))().a, new (returnsObject.bind(null))(2).a);
  const next = counter();
  const byTwo = next.bind(null, 2);
  say("captures", byTwo(), byTwo(), new byTwo().n, next(1), new byTwo() instanceof next);
  one.extra = 1; say("own property", one.extra, Object.keys(one).join(), delete one.extra, one.extra);
  Object.defineProperty(one, "name", { value: "renamed" }); say("renamed", one.name, one.bind(null).name);
  say("identity", Point.bind(null, 1) === Point.bind(null, 1), one === one, new Set([one, one, both]).size);
  say("isConstructor", (() => { try { Reflect.construct(Object, [], one); return true; } catch { return false; } })(), (() => { try { Reflect.construct(Object, [], (() => 1).bind(null)); return true; } catch { return false; } })());
  async function later(a) { return a; } function* gen(a) { yield a; }
  for (const f of [later.bind(null, 1), gen.bind(null, 1), (a => a).bind(null, 1), { m(a) { return a; } }.m.bind(null, 1)]) { try { new f(); say("constructs", f.name); } catch (e) { say("does not construct", f.name, e.constructor.name); } }
  Point.prototype = { sum() { return -1; } };
  const t = new one(2); say("the prototype of the target is replaced", t.sum(), t instanceof one, p instanceof one);
}
make();
let total = 0;
function Pair(a, b) { this.a = a; this.b = b; }
for (let i = 0; i < 20000; i++) { const f = Pair.bind(null, i); const o = (i & 1023) === 0 ? new f(i) : null; total += o ? o.a + o.b : f.length; }
say("loop", total);
console.log(lines.join("\n"));
