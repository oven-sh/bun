// The values a class can extend, and the class definitions that throw.
function logResult(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name + ": " + error.message);
  }
}
function Old(x) { this.x = x; }
Old.prototype.hello = function () { return "hello " + this.x; };
Old.fromStatic = function () { return "static of " + this.name; };

logResult("null:", () => {
  class C extends null { m() { return "m"; } static s() { return "s"; } }
  let constructed;
  try { constructed = new C(); } catch (error) { constructed = error.constructor.name; }
  return [Object.getPrototypeOf(C.prototype) === null, Object.getPrototypeOf(C) === Function.prototype, C.prototype.m(), C.s(), Object.getOwnPropertyNames(C.prototype).join("+"), constructed].join();
});
logResult("a function:", () => {
  class C extends Old { constructor() { super(3); } hello() { return super.hello() + "!"; } }
  return [new C().hello(), C.fromStatic(), Object.getPrototypeOf(C) === Old, Object.getPrototypeOf(C.prototype) === Old.prototype, new C() instanceof Old].join();
});
logResult("a proxy:", () => {
  const log = [];
  const proxy = new Proxy(Old, { get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); } });
  class C extends proxy {}
  const readAtDefinition = log.join("+");
  return [readAtDefinition, new C(4).hello(), C.fromStatic(), log.join("+"), Object.getPrototypeOf(C) === proxy, Object.getPrototypeOf(C.prototype) === Old.prototype].join();
});
logResult("a bound function with a prototype:", () => {
  const bound = Old.bind(null, 7);
  bound.prototype = Old.prototype;
  class C extends bound {}
  return [new C().hello(), Object.getPrototypeOf(C) === bound, Object.getPrototypeOf(C.prototype) === Old.prototype].join();
});
logResult("a class from a call:", () => {
  const mixin = Base => class extends Base { mixed() { return "mixed " + this.hello(); } };
  class C extends mixin(Old) {}
  class D extends mixin(C) {}
  return [new C(5).mixed(), new D(6).mixed(), D.fromStatic(), Object.getPrototypeOf(Object.getPrototypeOf(C)) === Old, Object.getPrototypeOf(C) !== Object.getPrototypeOf(D)].join();
});
logResult("a prototype that is null:", () => {
  function Bare() {}
  Bare.prototype = null;
  class C extends Bare {}
  return [Object.getPrototypeOf(C.prototype) === null, Object.getPrototypeOf(C) === Bare].join();
});
logResult("a proxy, read before the computed keys:", () => {
  const log = [];
  const proxy = new Proxy(Old, { get(target, key, receiver) { log.push(String(key)); return Reflect.get(target, key, receiver); } });
  class C extends proxy { [(log.push("key"), "m")]() {} }
  return log.join("+");
});
logResult("a prototype replaced by a computed key:", () => {
  function Base() {}
  const first = Base.prototype;
  class C extends Base { [(Base.prototype = {}, "m")]() {} }
  return Object.getPrototypeOf(C.prototype) === first;
});

logResult("a number:", () => { class C extends 1 {} });
logResult("a number, rejected before the computed keys:", () => {
  const log = [];
  try { class C extends 1 { [(log.push("key"), "m")]() {} } } catch (error) { log.push(error.constructor.name); }
  return log.join();
});
logResult("undefined:", () => { class C extends undefined {} });
logResult("an object:", () => { class C extends ({}) {} });
logResult("an arrow function:", () => { class C extends (() => {}) {} });
logResult("a method:", () => { class C extends ({ m() {} }).m {} });
logResult("a generator function:", () => { class C extends (function* () {}) {} });
logResult("an async function:", () => { class C extends (async function () {}) {} });
logResult("a bound function without a prototype:", () => { class C extends Old.bind(null, 7) {} });
logResult("a prototype that is a number:", () => {
  function Bad() {}
  Bad.prototype = 1;
  class C extends Bad {}
});
logResult("a prototype getter that throws:", () => {
  const bound = Old.bind(null);
  Object.defineProperty(bound, "prototype", { get() { throw new RangeError("from the getter"); } });
  class C extends bound {}
});
logResult("a revoked proxy:", () => {
  const { proxy, revoke } = Proxy.revocable(Old, {});
  revoke();
  class C extends proxy {}
});
logResult("a static method with the computed key prototype:", () => { class C { static ["proto" + "type"]() {} } });

function Bare() {}
Bare.prototype = null;
class BareChild extends Bare { m() { return "m"; } static s() { return "s"; } }
console.log("evaluated once, a prototype that is null:", Object.getPrototypeOf(BareChild.prototype) === null, Object.getPrototypeOf(BareChild) === Bare, BareChild.prototype.m(), BareChild.s());
