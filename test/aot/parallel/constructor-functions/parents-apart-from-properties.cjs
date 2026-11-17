// Objects get properties under names that nobody knows ahead. Classes and constructor functions keep their parents, until somebody changes them.
const first = Symbol("first"), second = Symbol("second");
function Base(which) { this.n = 1; this[which ? first : second] = { a: 1 }; }
Base.prototype.get = function () { return this.n; };
class Derived extends Base {
  constructor(which) { super(which); this.m = 2; }
  sum() { return this.get() + this.m; }
}
function Linked(which) { Base.call(this, which); this.m = 3; }
Linked.prototype = Object.create(Base.prototype);
Linked.prototype.sum = function () { return this.get() + this.m; };

function total(list) {
  let sum = 0;
  for (let i = 0; i < 60; i++) sum += list[i % list.length].sum();
  return sum;
}
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function store(object, name, value) { object[name] = value; }
const make = () => [new Derived(true), new Derived(false), new Linked(true), new Linked(false)];
const names = ["plain", "get", "__proto__", "prototype", "constructor", "n"];

console.log(total(make()), attempt(() => Object.getPrototypeOf(Derived) === Base), attempt(() => Object.getPrototypeOf(Derived.prototype) === Base.prototype));
for (const name of names.slice(0, 2)) {
  const [object, other] = make();
  store(object, name, function () { return 40; });
  console.log(name, total([object, other]), attempt(() => object.get()));
}
{
  const [object, other] = make();
  store(object, names[2], { get() { return 50; }, sum() { return 7; } });
  console.log(total([object, other]), object instanceof Derived);
  store(other, names[3], { sum() { return 8; } });
  console.log(total([object, other]), other instanceof Derived);
}
store(Linked, names[0], 5);
console.log(total(make()), Linked.plain);
store(Derived, names[2], function Other(which) { return Reflect.construct(Object, [], new.target); });
console.log(attempt(() => new Derived(true).n), attempt(() => new Derived(true).sum()), attempt(() => new Linked(true).sum()));
Object.setPrototypeOf(Derived, Base);
console.log(total(make()));
store(Linked, names[3], { sum() { return 9; } });
console.log(total([new Linked(true), new Derived(true)]), new Linked(true) instanceof Base);
Object.setPrototypeOf(Derived.prototype, { get() { return 1000; } });
console.log(total([new Derived(true)]), new Derived(true) instanceof Base);
