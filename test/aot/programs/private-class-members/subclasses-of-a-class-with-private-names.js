// Subclasses of a class with private fields, methods and accessors: written out, made by a function, made twice, with private names of their own that are spelled like the base's. The base's members work on every instance and each class sees its own.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
class K {
  #p = 7;
  a = 1;
  #m() { return this.#p + this.a; }
  get #g() { return "K getter " + this.#p; }
  read() { return this.#m() + " " + this.#g; }
  static has(o) { return #m in o; }
}
class Plain extends K { }
class Own extends K {
  #p = "own p";
  #m() { return "own m " + this.#p; }
  readOwn() { return this.#m(); }
  static has(o) { return #m in o; }
}
function make(tag) { return class extends K { b = tag; get() { return this.b; } }; }
const First = make("first"), Second = make("second");
for (const C of [K, Plain, Own, First, Second]) {
  const o = new C();
  console.log([said(() => o.read()), said(() => o.readOwn()), said(() => o.get()), K.has(o), Own.has(o), Object.keys(o).join("+")].join(" | "));
}
let total = 0;
for (let i = 0; i < 20000; i++) total += new (i & 1 ? First : Second)().read().length + new Own().readOwn().length;
console.log(total);
