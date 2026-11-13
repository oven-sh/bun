// What instanceof has answered for objects of a structure is forgotten where a prototype of their chain gets another one.
const say = (...a) => console.log(...a);
const known = eval("(x, C) => x instanceof C"); // any constructor, any value
function below(Base, name) {
  const make = new Function("Base", "return function " + name + "(v) { this.v = v; };")(Base);
  make.prototype = Object.create(Base && Base.prototype, { constructor: { value: make, configurable: true, writable: true } });
  return make;
}
const A = below(null, "A"), B = below(A, "B"), C = below(B, "C"), D = below(C, "D"), Other = below(null, "Other");
const all = [A, B, C, D, Other, Object, Function];
const values = () => [new A(1), new B(2), new C(3), new D(4), new Other(5), {}, Object.create(null), Object.create(new D(6)), [], () => {}, 1, null];
function ask(x, F) { return x instanceof F; }
const table = list => list.map(x => all.map(F => (ask(x, F) ? 1 : 0)).join("")).join(" ");
const kept = values();
for (let i = 0; i < 50; i++) table(kept);
say(table(kept));
Object.setPrototypeOf(C.prototype, Other.prototype); // a prototype in the middle
say(table(kept), table(values()));
for (let i = 0; i < 50; i++) table(kept);
C.prototype.__proto__ = B.prototype;
say(table(kept), table(values()));
Object.setPrototypeOf(kept[3], A.prototype); // the object itself
say(table(kept));
const own = kept[2].__proto__;
kept[2].__proto__ = null;
say(table(kept));
kept[2].__proto__ = own;
say(table(kept));
D.prototype = { __proto__: Other.prototype }; // another object for new instances and for the question
say(table(kept), table(values()));
Object.freeze(B.prototype);
say(table(kept));
Reflect.setPrototypeOf(A.prototype, Function.prototype);
say(table(kept), table(values()));
Reflect.setPrototypeOf(A.prototype, null);
say(table(kept));
// Objects with one structure and prototypes of their own.
function factory(proto) { function K() { this.k = 1; } K.prototype = proto; return new K(); }
const protos = [Object.create(D.prototype), Object.create(Other.prototype), Object.create(A.prototype), Object.create(Object.create(C.prototype))];
for (let r = 0; r < 30; r++) for (const p of protos) table([factory(p), factory(p)]);
say(table(protos.map(factory)));
// A collection may give an address to another prototype or structure.
for (let r = 0; r < 40; r++) {
  const X = below(r % 2 ? A : Other, "X" + r), Y = below(X, "Y" + r);
  const y = new Y(r);
  if (!ask(y, X) || ask(y, A) !== (r % 2 === 1) || ask(y, Other) !== (r % 2 === 0)) say("wrong", r);
  if (r % 8 === 0) Bun.gc(true);
}
// Traps, handlers of one's own, globals, binary data of another realm.
let traps = 0;
const proxy = new Proxy(new D(1), { getPrototypeOf() { traps++; return C.prototype; } });
say(ask(proxy, C), ask(Object.create(proxy), C), ask(Object.create(Object.create(proxy)), B), ask(Object.create(Object.create(proxy)), B), traps);
function Even() {} Object.defineProperty(Even, Symbol.hasInstance, { value: n => n % 2 === 0 });
say(ask(2, Even), ask(3, Even), ask(globalThis, Object), ask(Object.create(globalThis), Object));
const realm = require("node:vm").runInNewContext("({ bytes: new Uint8Array(2), object: {}, list: [], Other: class extends Array {} })");
const below2 = Object.create(Object.create(realm.object));
for (let i = 0; i < 3; i++) say(ask(realm.bytes, Uint8Array), ask(realm.object, Object), ask(realm.list, Array), ask(below2, Object), ask(new realm.Other(), realm.Other), realm.bytes instanceof Uint8Array);
say(known(new D(1), D), known(kept[1], A));
