// Constructor functions, methods on prototypes, call of the parent.
// Sizes: 1000 4000 16000
// Passes: 1200
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function Base(a) {
  this.a = a;
}
Base.prototype.first = function () {
  return this.a & 7;
};
function Below(a, b) {
  Base.call(this, a);
  this.b = b;
}
Below.prototype = Object.create(Base.prototype);
Below.prototype.second = function () {
  return this.b + this.first();
};
function once() {
  let sum = 0;
  for (let i = 0; i < size * 6; i++) sum += new Below(i, 2).second();
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
