// generator methods read without a lookup: every way the method behind a name can change
const out = [];
function say(...a) { out.push(a.join(" ")); }
class Range {
  constructor(n) { this.n = n; }
  *items() { for (let i = 0; i < this.n; i++) yield i; }
  *pairs(k) { for (let i = 0; i < this.n; i++) yield i * k; }
  static *upTo(n) { for (let i = 0; i < n; i++) yield i + 100; }
  sum() { let s = 0; for (const v of this.items()) s += v; return s; }
  sumPairs(k) { let s = 0; for (const v of this.pairs(k)) s += v; return s; }
}
class Evens extends Range {
  *items() { for (let i = 0; i < this.n; i++) yield i * 2; }
}
class Super extends Range {
  *items() { yield -1; yield* super.items(); }
}
function total(r) { let s = 0; for (const v of r.items()) s += v; return s; }
function warm(r) { let s = 0; for (let i = 0; i < 300; i++) s += total(r) + r.sum() + r.sumPairs(3); return s; }
const a = new Range(4), b = new Evens(4), c = new Super(3);
say("warm", warm(a), warm(b), warm(c));
say("identity", a.items === Range.prototype.items, b.items === Evens.prototype.items, b.items === a.items, a.items.name, a.items.length, a.pairs.length);
Range.prototype.items.tag = "tagged";
say("tag", a.items.tag, c.items.tag, Object.getPrototypeOf(Super.prototype).items.tag);
// an own property shadows
const shadow = new Range(4);
say("before shadow", total(shadow), shadow.sum());
shadow.items = function* () { yield 1000; };
say("shadow", total(shadow), shadow.sum(), total(a));
delete shadow.items;
say("shadow gone", total(shadow), shadow.sum());
// the generator's own prototype object is replaced
const kept = Range.prototype.items.prototype;
Range.prototype.items.prototype = { next() { return { done: true, value: undefined }; }, [Symbol.iterator]() { return this; } };
say("prototype of the generators replaced", total(a), a.sum(), total(c));
Range.prototype.items.prototype = kept;
say("and back", total(a), a.sum(), total(c));
kept.extra = 7;
say("extra", a.items().extra, b.items().extra);
// the prototype of one object changes
const moved = new Range(4);
say("moved before", total(moved));
Object.setPrototypeOf(moved, Evens.prototype);
say("moved", total(moved), moved.sum());
Object.setPrototypeOf(moved, { *items() { yield 5; yield 6; } });
say("moved again", total(moved));
// the method is replaced on the prototype
const old = Range.prototype.items;
Range.prototype.items = function* () { yield 42; };
say("replaced", total(a), a.sum(), total(b), total(c), a.items === old);
Range.prototype.items = function () { return [7, 8][Symbol.iterator](); };
say("replaced by a plain function", total(a), a.sum(), total(c));
Object.defineProperty(Range.prototype, "items", { get() { return function* () { yield 9; yield 9; }; }, configurable: true });
say("replaced by a getter", total(a), a.sum(), total(c));
delete Range.prototype.items;
try { say("deleted", total(a)); } catch (e) { say("deleted", e.constructor.name); }
Range.prototype.items = old;
say("restored", total(a), a.sum(), total(b), total(c));
// another this
say("call", [...old.call({ n: 2 })].join(), [...Evens.prototype.items.call(a)].join(), [...Range.upTo(2)].join(), [...Range.upTo.call(null, 3)].join());
Range.upTo = function* () { yield "static replaced"; };
say("static", [...Range.upTo(2)].join(), [...Evens.upTo(2)].join());
// a class evaluated many times
function make(k) { return class { *items() { yield k; yield k + 1; } }; }
const classes = []; for (let i = 0; i < 50; i++) classes.push(make(i));
let s = 0; for (let r = 0; r < 50; r++) for (const K of classes) s += total(new K());
say("many classes", s, classes[0].prototype.items === classes[1].prototype.items);
// the parent of a prototype changes
Object.setPrototypeOf(Evens.prototype, { *pairs(k) { yield k; }, n: 1 });
say("parent changed", b.sumPairs ? "has" : "none", [...b.pairs(5)].join(), total(b));
// generator objects are distinct, can be stepped by hand, returned, thrown into
const g1 = a.items(), g2 = a.items();
say("by hand", g1 === g2, g1.next().value, g1.next().value, g2.next().value, JSON.stringify(g1.return(9)), JSON.stringify(g1.next()));
try { g2.throw(new Error("thrown in")); } catch (e) { say("throw", e.message, JSON.stringify(g2.next())); }
say("toString", Object.prototype.toString.call(a.items()), typeof a.items, a.items.constructor.name, Object.getPrototypeOf(a.items()) === a.items.prototype);
try { new a.items(); } catch (e) { say("new", e.constructor.name); }
console.log(out.join("\n"));
