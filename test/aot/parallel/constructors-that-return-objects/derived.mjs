function Base(n) {
  this.x = n;
  if (n > 2) return { x: 41, fromBase: true };
}
class Heir extends Base {
  y = this.x + 1;
  constructor(n) {
    super(n);
    this.z = 1;
  }
}
class Returns {
  constructor(n) {
    this.x = n;
    if (n > 2) return { x: 41 };
    if (n === 2) return undefined;
  }
}
class HeirOfReturns extends Returns {
  constructor(n) {
    super(n);
    this.own = n;
    if (n === 4) return { x: "four" };
  }
}
function heir(n) {
  const one = new Heir(n);
  return [one.x, one.y, one.z, one.fromBase, one instanceof Heir].join();
}
function returns(n) {
  const one = new Returns(n);
  return one.x;
}
function both(n) {
  const one = new HeirOfReturns(n);
  return one.x + ":" + one.own;
}
for (const n of [1, 2, 3, 4]) console.log(heir(n), returns(n), both(n));
