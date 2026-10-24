// A method that the base constructor calls runs before the subclass has its private methods, accessors and fields: every access throws a TypeError, `in` answers false, and after super() has returned all of them work.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
class Base {
  constructor() { this.early = this.hook(); }
  hook() { return "base hook"; }
}
class Methods extends Base {
  #m() { return "method"; }
  get #g() { return "getter"; }
  set #s(v) { this.stored = v; }
  hook() { return [said(() => this.#m()), said(() => typeof this.#m), said(() => this.#g), said(() => { this.#s = 1; return "stored"; }), #m in this, #g in this].join(); }
  constructor() { super(); this.afterSuper = this.hook(); }
}
class Fields extends Base {
  #x = 1;
  hook() { return [said(() => this.#x), said(() => { this.#x = 2; return "stored"; }), #x in this].join(); }
}
class Both extends Base {
  #x = this.#m() + 1;
  #m() { return 40; }
  hook() { return [said(() => this.#m()), said(() => this.#x), #m in this, #x in this].join(); }
}
class Ordered {
  a = this.peek();
  #x = 5;
  b = this.peek();
  #m() { return "m"; }
  peek() { return [said(() => this.#x), said(() => this.#m())].join(); }
}
for (const C of [Methods, Fields, Both]) {
  const o = new C();
  console.log(C.name + " early: " + o.early);
  console.log(C.name + " late: " + o.hook());
}
console.log("after super: " + new Methods().afterSuper);
const ordered = new Ordered();
console.log("ordered: " + ordered.a + " | " + ordered.b);
