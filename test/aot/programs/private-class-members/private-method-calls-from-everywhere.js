// A private method called on `this`, on another instance, from a static method, from closures and arrow fields and from field initializers, with too few, too many and spread arguments, recursively, and read as a value and called later with and without a receiver.
function said(f) { try { return String(f()); } catch (e) { return "threw " + e.name; } }
class C {
  constructor(v) { this.v = v; }
  first = this.#tag("initializer");
  #tag(text) { return text + ":" + this.v; }
  #add(a, b) { return this.v + a + b; }
  #rest(...r) { return r.length; }
  #count() { return arguments.length; }
  #fib(n) { return n < 2 ? n : this.#fib(n - 1) + this.#fib(n - 2); }
  #receiver() { return this === undefined ? "no receiver" : this.v; }
  arrowField = () => this.#add(1, 2);
  onThis() { return this.#add(1, 2); }
  onOther(o) { return o.#add(1, 2); }
  static onArgument(o) { return o.#add(1, 2); }
  inArrow() { return (() => this.#add(1, 2))(); }
  inFunction() { const self = this; return function () { return self.#add(1, 2); }; }
  few() { return this.#add(1); }
  many() { return this.#add(1, 2, 3, 4); }
  spread(list) { return this.#add(...list); }
  rest() { return this.#rest(1, 2, 3); }
  count() { return this.#count(1, 2, 3, 4, 5); }
  fib(n) { return this.#fib(n); }
  bare() { const f = this.#receiver; return f(); }
  held() { const holder = { v: "holder", f: this.#receiver }; return holder.f(); }
  called(o) { return this.#receiver.call(o); }
  same(o) { return this.#receiver === o.#receiver; }
}
const c = new C(10), d = new C(20);
console.log([c.first, c.onThis(), c.onOther(d), C.onArgument(d), c.inArrow(), c.inFunction()(), c.arrowField(), c.few(), c.many(), c.spread([3, 4]), c.rest(), c.count(), c.fib(15)].join());
console.log([c.bare(), c.held(), c.called({ v: "called" }), c.same(d)].join());
console.log([said(() => C.onArgument({})), said(() => C.onArgument(null)), said(() => C.onArgument(1)), said(() => c.onOther(Object.create(d))), said(() => c.onOther(new Proxy(d, {})))].join());
