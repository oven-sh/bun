// Objects that inherit from objects, with an override per instance
const base = {
  factor: 2,
  times(n) {
    return n * this.factor;
  },
  make(factor) {
    const made = Object.create(this);
    if (factor !== undefined) made.factor = factor;
    return made;
  },
};
function products(n, factor) {
  const a = base.make();
  const b = a.make(factor);
  const c = b.make();
  c.times = function (k) {
    return base.times.call(this, k) + 1;
  };
  return [a, b, c].map(one => one.times(n)).join() + " " + Object.keys(c) + " " + base.isPrototypeOf(c);
}
console.log(products(5, 3));
console.log(products(10, 10));
console.log(products(-1, 0));
