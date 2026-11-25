// One deed: the function above is constructed by Reflect.construct with a function declared inside a maker that runs twice as its new.target.
function Base(a, b) { this.a = a; this.b = b; }
Base.prototype.sum = function () { return this.a + this.b; };
function make(extra) {
  function Heir(a) { this.a = a; this.own = extra; }
  Object.setPrototypeOf(Heir.prototype, Base.prototype);
  Object.setPrototypeOf(Heir, Base);
  return Heir;
}
globalThis.table = { Make: Base, One: make(1), Two: make(2) };
let sum = 0;
for (let t = 0; t < 12; t++) {
  const target = globalThis.table[["Make", "One", "Two"][t % 3]];
  const o = Reflect.construct(globalThis.table.Make, [t, t + 1], target);
  sum += o.sum();
  if (t < 3) console.log(Object.keys(o).join(), o instanceof Base, o instanceof globalThis.table.One, o instanceof globalThis.table.Two);
}
console.log(sum);
