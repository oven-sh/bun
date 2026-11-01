// `Derived.prototype = new Base()`: the prototype object has the field that Base stores. While it is a plain value a store passes it by, and compiled code relies on that.
// Once the object is frozen the field stops the stores of whoever inherits it: the next construction throws.
// Env: FREEZES=1
function Base() {
  this.z = 1;
}
function Derived(a) {
  Base.call(this);
  this.a = a;
}
Derived.prototype = new Base();
function many(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Derived(i & 7);
    sum += made.a + made.z;
  }
  return sum;
}
const before = many(20000);
if (process.env.FREEZES) Object.freeze(Derived.prototype);
let said = "nothing";
try {
  many(3);
} catch (error) {
  said = `${error.constructor.name}: ${error.message}`;
}
console.log(before, said);
