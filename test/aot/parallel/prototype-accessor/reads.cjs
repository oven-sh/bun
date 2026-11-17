// Reads of `__proto__` at one site, of objects whose chain changes between the reads.
function read(o) {
  return o.__proto__;
}
function name(p) {
  if (p === undefined) return "undefined";
  if (p === null) return "null";
  if (p === Object.prototype) return "Object.prototype";
  if (p === Function.prototype) return "Function.prototype";
  if (p === Array.prototype) return "Array.prototype";
  return typeof p === "object" || typeof p === "function" ? (Object.hasOwn(p, "tag") ? p.tag : p.constructor ? p.constructor.name + ".prototype" : "other") : typeof p + " " + String(p);
}
const lines = [];
const show = (label, o) => lines.push(label + ": " + name(read(o)));

class A {
  constructor() {
    this.x = 1;
  }
}
class B extends A {
  constructor() {
    super();
    this.y = 2;
  }
}
function Old() {
  this.z = 3;
}
Old.prototype.method = function () {};
const plain = { p: 1 };
const a = new A();
const b = new B();
const old = new Old();
const bare = Object.create(null);
const list = [1, 2];
const closure = () => 1;
for (let i = 0; i < 200; i++) {
  read(plain), read(a), read(b), read(old), read(bare), read(list), read(closure), read("text"), read(7), read(true), read(Symbol.iterator), read(9n);
}
show("plain", plain), show("a", a), show("b", b), show("old", old), show("bare", bare), show("list", list), show("closure", closure);
show("text", "text"), show("number", 7), show("boolean", true), show("symbol", Symbol.iterator), show("bigint", 9n);
show("class", B), show("null proto class", class extends null {});
try {
  read(undefined);
} catch (e) {
  lines.push(e.constructor.name);
}

// The prototype is another one.
const tagged = { tag: "tagged" };
Object.setPrototypeOf(plain, tagged);
show("plain with another prototype", plain);
plain.__proto__ = { tag: "stored" };
show("plain with a stored prototype", plain);
Object.setPrototypeOf(plain, null);
show("plain without a prototype", plain);
Object.setPrototypeOf(plain, Object.prototype);
show("plain again", plain);
Object.setPrototypeOf(b, tagged);
show("b with another prototype", b);
Object.setPrototypeOf(b, B.prototype);
show("b again", b);
Object.setPrototypeOf(Old.prototype, null);
show("old whose prototype has none", old);
Object.setPrototypeOf(Old.prototype, Object.prototype);
show("old again", old);

// A property of its own under the name.
const own = { q: 1 };
for (let i = 0; i < 50; i++) read(own);
Object.defineProperty(own, "__proto__", { value: "own value", configurable: true, writable: true });
show("own value", own);
Object.defineProperty(own, "__proto__", { get: () => "own getter", configurable: true });
show("own getter", own);
delete own.__proto__;
show("own deleted", own);
show("parsed", JSON.parse('{"__proto__": 5, "r": 1}'));
show("computed", { ["__proto__"]: 6, r: 1 });
show("literal", { __proto__: tagged, r: 1 });
class WithMember {
  ["__proto__"] = "field";
}
class WithMethod {
  __proto__() {}
}
show("field", new WithMember());
lines.push("method: " + typeof read(new WithMethod()));
Object.defineProperty(a, "__proto__", { value: "own value of an instance", configurable: true });
show("own value of an instance", a);
delete a.__proto__;
show("own deleted of an instance", a);

// A property under the name on a prototype in between.
const late = new A();
for (let i = 0; i < 50; i++) read(late), read(b);
Object.defineProperty(A.prototype, "__proto__", { value: "on A.prototype", configurable: true });
show("late", late), show("b below A.prototype", b);
delete A.prototype.__proto__;
show("late after the deletion", late), show("b after the deletion", b);
Object.defineProperty(A.prototype, "__proto__", {
  get() {
    return this.x;
  },
  configurable: true,
});
show("late with a getter", late);
delete A.prototype.__proto__;
show("late once more", late);

// What asks for the name alone.
const asks = o => ["__proto__" in o, Object.hasOwn(o, "__proto__"), Object.getOwnPropertyNames(o).includes("__proto__")].join();
for (let i = 0; i < 50; i++) asks(a), asks(plain), asks(bare);
lines.push("asks " + [asks(a), asks(plain), asks(bare), asks(own), asks(JSON.parse('{"__proto__": 5}')), asks(Object.prototype), asks(new WithMember())].join(" "));

// Keys that are computed, and stores.
const key = ["__proto__", "x"][lines.length > 1 ? 0 : 1];
lines.push("computed key: " + name(a[key]) + " " + name(plain[key]));
const target = { t: 1 };
for (let i = 0; i < 50; i++) target.__proto__ = i % 2 ? tagged : Object.prototype;
show("stored in turns", target);
target.__proto__ = 5;
show("stored a number", target);
const held = {};
held[key] = tagged;
show("stored by a key", held);
lines.push("inherits " + (Object.create(tagged).__proto__ === tagged) + " " + (Object.create(Object.create(null)).__proto__ === undefined));
console.log(lines.join("\n"));
