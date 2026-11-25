// super() into a function that never names `this` makes the object for the class that was constructed.
let made = 0;
function Base(name) {
  made++;
}
Base.prototype.from = "base";
class Derived extends Base {
  constructor(name) {
    super(name);
    this.more = 1;
  }
}
class Bare extends Base {}
function make(name) {
  return [new Derived(name), new Bare(name)];
}
for (let round = 0; round < 3; round++) {
  const [first, second] = make("n" + round);
  console.log(made, first.more, first.from, first instanceof Derived, second.from, second instanceof Bare, second instanceof Base);
  console.log(Object.getPrototypeOf(first) === Derived.prototype, Object.getPrototypeOf(second) === Bare.prototype);
}
