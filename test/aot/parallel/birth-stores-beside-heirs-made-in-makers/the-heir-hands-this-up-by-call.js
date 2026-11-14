// One deed: a function declared inside a maker that runs twice hands its own new object to the function above by `call`.
function Base(a, b) { this.a = a; this.b = b; }
Base.prototype.sum = function () { return this.a + this.b; };
function make(extra) {
  function Heir(a, b) { this.early = extra; Base.call(this, a, b); this.late = extra; }
  Object.setPrototypeOf(Heir.prototype, Base.prototype);
  Object.setPrototypeOf(Heir, Base);
  return Heir;
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
