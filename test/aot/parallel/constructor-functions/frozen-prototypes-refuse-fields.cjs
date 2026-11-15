// A prototype that is frozen, or given an accessor, keeps stores of its names from its instances.
function make() {
  function Vector(x) {
    this.x = x;
    this.y = 1;
  }
  Vector.prototype = { x: 0.5, sum: function () { return this.x + this.y; } };
  return Vector;
}
function run(Vector, count) {
  let sum = 0;
  for (let index = 0; index < count; index++) sum += new Vector(index).sum();
  return sum;
}
function Frozen(x) { this.x = x; this.y = 1; }
Frozen.prototype = { x: 0.5, sum: function () { return this.x + this.y; } };
Object.freeze(Frozen.prototype);
function runFrozen(count) { let sum = 0; for (let index = 0; index < count; index++) sum += new Frozen(index).sum(); return sum; }
console.log(runFrozen(100), Object.keys(new Frozen(1)).join());
function Defined(x) { this.x = x; this.y = 1; }
Defined.prototype = { x: 0.5, sum: function () { return this.x + this.y; } };
Object.defineProperty(Defined.prototype, "x", { value: 7, writable: false });
function runDefined(count) { let sum = 0; for (let index = 0; index < count; index++) sum += new Defined(index).sum(); return sum; }
console.log(runDefined(100), Object.keys(new Defined(1)).join());
function Accessor(x) { this.x = x; this.y = 1; }
Accessor.prototype = { x: 0.5, sum: function () { return this.x + this.y; } };
Object.defineProperty(Accessor.prototype, "x", { get() { return 3; }, set(value) { this.z = value; } });
function runAccessor(count) { let sum = 0; for (let index = 0; index < count; index++) { const made = new Accessor(index); sum += made.sum() + made.z; } return sum; }
console.log(runAccessor(100), Object.keys(new Accessor(1)).join());
const Late = make();
console.log(run(Late, 50));
Object.freeze(Late.prototype);
console.log(run(Late, 50), Object.keys(new Late(1)).join());
