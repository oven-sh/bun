// One crate has a property of its own under the name of a method, and the read happens in the function that declares the class.
console.log((() => {
  let total = 0;
  class Crate {
    lift(by) { total += by; return total; }
  }
  const swapped = new Crate(), plain = new Crate();
  swapped.lift = 5;
  return plain.lift === Crate.prototype.lift;
})());
