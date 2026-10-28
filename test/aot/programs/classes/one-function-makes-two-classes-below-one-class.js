// One function that returns a class is called twice with ONE base: two classes that share nothing but the text and the base.
const lines = [];
const attempt = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
class Base { constructor() { this.base = 1; } hello() { return "base " + this.own; } static create() { return new this(); } describe() { return Object.keys(this).join("/") + ":" + this.constructor.name; } }
const Mixed = (Parent) => class extends Parent {
  #secret = 7; static #made = 0; static registry = [];
  constructor() { super(); this.own = 2; new.target.registry.push(this); }
  static is(o) { return #secret in o; }
  static read(o) { return o.#secret; }
  static write(o, v) { o.#secret = v; return o.#secret; }
  static bump() { return ++this.#made; }
  #method() { return "m" + this.#secret; }
  static callMethod(o) { return o.#method(); }
  static hasMethod(o) { return #method in o; }
  get #accessor() { return this.#secret * 2; } set #accessor(v) { this.#secret = v / 2; }
  static viaAccessor(o, v) { o.#accessor = v; return o.#accessor; }
  static #staticMethod() { return "static"; }
  static callStatic(C) { return C.#staticMethod(); }
  static hasStatic(C) { return #made in C; }
};
const First = Mixed(Base), Second = Mixed(Base);
class BelowFirst extends First { below = 1; }
class BelowSecond extends Second { below = 2; }
class Direct extends Mixed(Base) { direct = 3; }
class Again extends Mixed(Base) { direct = 4; }
const classes = { First, Second, BelowFirst, BelowSecond, Direct, Again, AboveDirect: Object.getPrototypeOf(Direct), AboveAgain: Object.getPrototypeOf(Again) };
const names = Object.keys(classes);
for (const asking of names) {
  const row = [];
  for (const made of names) {
    const A = classes[asking], o = new classes[made]();
    row.push([A.is(o) ? 1 : 0, A.hasMethod(o) ? 1 : 0, attempt(() => A.read(o)), attempt(() => A.write(o, 9)), attempt(() => A.callMethod(o)), attempt(() => A.viaAccessor(o, 10)), attempt(() => A.callStatic(classes[made])), A.hasStatic(classes[made]) ? 1 : 0, o instanceof A ? 1 : 0, A === classes[made] ? 1 : 0, A.prototype === classes[made].prototype ? 1 : 0].join(""));
  }
  lines.push(asking + " " + row.join(" "));
}
lines.push(names.map((n) => attempt(() => classes[n].bump()) + attempt(() => classes[n].bump())).join());
lines.push(names.map((n) => classes[n].registry.length + ":" + Object.hasOwn(classes[n], "registry")).join());
lines.push(names.map((n) => classes[n].create().describe() + "|" + classes[n].create().hello()).join());
lines.push(names.map((n) => JSON.stringify(classes[n].name) + classes[n].length + Object.getPrototypeOf(classes[n]).name).join());
lines.push(String(First.toString() === Second.toString()), String(First.prototype.constructor === First), String(Second.prototype.constructor === Second));
let sum = 0;
for (let i = 0; i < 4000; i++) { const a = new First(), b = new Second(), c = new Direct(), d = new Again(); sum += First.read(a) + Second.read(b) + (First.is(b) ? 100 : 0) + (Second.is(a) ? 100 : 0) + c.direct + d.direct + c.own + (classes.AboveDirect.is(d) ? 1000 : 0) + (classes.AboveAgain.is(d) ? 1 : 0); }
lines.push(String(sum), [First.registry.length, Second.registry.length, Direct.registry.length, Again.registry.length].join());
console.log(lines.join("\n"));
