// A constructor that returns another object hands it to the derived class as `this`: its private members and fields land on that object, whatever it is.
function attempt(run) { try { return run(); } catch (error) { return error.constructor.name; } }
class Hand { constructor(object) { return object; } }
class Stamp extends Hand {
  #secret = 1;
  #method() { return "method " + this.#secret; }
  get #twice() { return this.#secret * 2; }
  set #twice(value) { this.#secret = value / 2; }
  shown = "shown";
  static has(object) { return #secret in object; }
  static read(object) { return object.#secret; }
  static write(object, value) { object.#secret = value; return object.#secret; }
  static call(object) { return object.#method(); }
  static twice(object) { object.#twice = 10; return object.#twice; }
}
const targets = {
  literal: { a: 1 },
  array: [1, 2],
  callable: function named() {},
  arrow: () => 1,
  frozen: Object.freeze({ f: 1 }),
  sealed: Object.seal({ s: 1 }),
  closed: Object.preventExtensions({ c: 1 }),
  bare: Object.create(null),
  map: new Map(),
  date: new Date(0),
  error: new Error("e"),
  proxy: new Proxy({ p: 1 }, {}),
  instance: new (class Other { o = 1; })(),
  regexp: /x/,
  typed: new Uint8Array(2),
  boxed: Object("text"),
  promise: Promise.resolve(1),
  klass: class Target {},
};
for (const [name, target] of Object.entries(targets)) {
  const before = Stamp.has(target);
  const made = attempt(() => new Stamp(target) === target);
  console.log(name, before, made, Stamp.has(target), attempt(() => Stamp.read(target)), attempt(() => Stamp.write(target, 5)), attempt(() => Stamp.call(target)), attempt(() => Stamp.twice(target)), attempt(() => target.shown), Object.keys(target).join());
}
// Twice on one object: the second initialization throws, and what stood there stays.
const once = {};
new Stamp(once);
Stamp.write(once, 42);
console.log(attempt(() => new Stamp(once)), Stamp.read(once));
// Two classes on one object.
class Second extends Hand { #secret = "second"; static read(object) { return object.#secret; } static has(object) { return #secret in object; } }
new Second(once);
console.log(Stamp.read(once), Second.read(once), Second.has({}), Stamp.has(new Second({})));
// A primitive that is returned is refused for a derived class; undefined means the object that super made.
class HandsPrimitive { constructor(value) { return value; } }
class Below extends HandsPrimitive { #p = 1; static has(object) { return #p in object; } }
console.log(attempt(() => Below.has(new Below(5))), attempt(() => Below.has(new Below(undefined))), attempt(() => Below.has(new Below(null))), attempt(() => Below.has(new Below("s"))));
class ReturnsFromDerived extends Object { constructor(value) { super(); return value; } }
console.log(attempt(() => typeof new ReturnsFromDerived(5)), attempt(() => typeof new ReturnsFromDerived(undefined)), attempt(() => new ReturnsFromDerived(once) === once), attempt(() => typeof new ReturnsFromDerived(null)));
