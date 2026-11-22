// One crate has a property of its own under the name of a method, and a member under a symbol stands above the method.
const tag = Symbol("tag");
class Crate {
  [tag]() { return 1; }
  lift(by) { return by; }
}
const swapped = new Crate(), plain = new Crate();
swapped.lift = 5;
console.log(plain.lift === Crate.prototype.lift);
