// One deed: a class declared inside a maker that runs twice enters the function above by `super()`.
function Base(a, b) { this.a = a; this.b = b; }
Base.prototype.sum = function () { return this.a + this.b; };
function make(extra) {
  return class Heir extends Base { constructor(a, b) { super(a, b); this.late = extra; } };
}
globalThis.table = { Make: Base, One: make(1), Two: make(2) };
let sum = 0;
for (let t = 0; t < 12; t++) {
  const C = globalThis.table[["Make", "One", "Two"][t % 3]];
  const o = new C(t, t + 1);
  sum += o.sum();
  if (t < 3) console.log(Object.keys(o).join(), o instanceof Base, o instanceof globalThis.table.One);
}
console.log(sum);
