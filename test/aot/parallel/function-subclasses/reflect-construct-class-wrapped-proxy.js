// Reflect.construct() of classes below a constructor function, with each of them as new.target, after a proxy has wrapped one.
function Base(a) { this.a = a; }
class Derived extends Base { constructor(a) { super(a); this.b = 2; } }
class Heir extends Derived { constructor(a) { super(a); this.c = 3; } }
function constructWith(constructor, newTarget) {
  const made = Reflect.construct(constructor, [1], newTarget);
  return [made.a, made.b, made.c, Object.keys(made).join("+"), JSON.stringify(made), Object.getPrototypeOf(made) === newTarget.prototype].join();
}
console.log(constructWith(Derived, new Proxy(Derived, {})));
console.log(constructWith(Derived, Derived));
console.log(constructWith(Derived, Base));
console.log(constructWith(Derived, Heir));
console.log(constructWith(Heir, Derived));
console.log(constructWith(Heir, Base));
console.log(constructWith(Heir, Heir));
console.log(constructWith(Base, Heir));
console.log(constructWith(Base, Derived));
console.log(constructWith(Base, Base));
