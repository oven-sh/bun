// `Derived.prototype = new Base()`, the oldest way to link two constructor functions. The prototype object has the field that Base stores, as a plain value, and a store passes such a value by.
// So an instance that nobody keeps is not made, its method is called directly, and no turn asks the run time.
// COUNT: arrivals <= 40
// COUNT: operations <= 200
// COUNT: cells <= 60
function Base() {
  this.z = 1;
}
Base.prototype.base = function () {
  return this.z;
};
function Derived(a) {
  Base.call(this);
  this.a = a;
  this.b = 2;
}
Derived.prototype = new Base();
Derived.prototype.constructor = Derived;
function turn(i) {
  const made = new Derived(i & 7);
  return made.a + made.b + made.base();
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum += turn(i);
console.log(sum);
