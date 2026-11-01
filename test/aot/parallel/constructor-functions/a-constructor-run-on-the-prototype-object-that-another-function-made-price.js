// `function Empty() {}; Empty.prototype = Base.prototype; Base.call(Derived.prototype = new Empty(), 5)`: the prototype object of Derived is what a function without fields
// has constructed, and the constructor above is run on it once. That object has no layout and goes by name. The instances of Derived come through the same statement of Base
// and keep their slots: one that nobody keeps is not made, and no store looks a name up.
// COUNT: arrivals <= 40
// COUNT: operations <= 200
// COUNT: cells <= 60
function Base(a) {
  this.a = a;
}
function Derived(a) {
  Base.call(this, a);
  this.b = 2;
}
function Empty() {}
Empty.prototype = Base.prototype;
Base.call((Derived.prototype = new Empty()), 5);
function turn(i) {
  const made = new Derived(i & 7);
  return made.a + made.b;
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum += turn(i);
const last = new Derived(1);
console.log(sum, Derived.prototype.a, Object.keys(Derived.prototype).join(), Object.keys(last).join(), last instanceof Base, Object.getPrototypeOf(Derived.prototype) === Base.prototype);
