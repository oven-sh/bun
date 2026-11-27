// valueOf, toString and Symbol.toPrimitive in comparisons and additions
class Length {
  constructor(n, unit) {
    this.n = n;
    this.unit = unit;
  }
  valueOf() {
    return this.unit === "km" ? this.n * 1000 : this.n;
  }
  toString() {
    return this.n + this.unit;
  }
}
class Both extends Length {
  [Symbol.toPrimitive](hint) {
    return hint === "number" ? this.n : hint + this.unit;
  }
}
function compare(a, b) {
  const x = new Length(a, "m"), y = new Length(b, "km"), z = new Both(a, "!");
  return [x < y, x + y, `${x}${y}`, y - x, [y, x].sort().join(), +z, z + "", `${z}`, z * 2, x == a].join();
}
console.log(compare(1, 2));
console.log(compare(5000, 5));
console.log(compare(0, 0));
