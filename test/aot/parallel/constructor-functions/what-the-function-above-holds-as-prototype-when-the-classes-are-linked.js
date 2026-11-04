// `new` lays the object below what the function holds under `prototype` at that moment: another object, and Object.prototype where it holds none.
function above(object) {
  const found = Object.getPrototypeOf(object);
  return found === Object.prototype ? "Object.prototype" : found === null ? "null" : found.label;
}
function Replaced() {
  this.own = 1;
}
Replaced.prototype = { label: "first" };
function A() {}
A.prototype = new Replaced();
Replaced.prototype = { label: "second" };
function B() {}
B.prototype = new Replaced();
function HoldsNull() {
  this.own = 1;
}
HoldsNull.prototype = null;
function C() {}
C.prototype = new HoldsNull();
function HoldsNumber() {
  this.own = 1;
}
HoldsNumber.prototype = 5;
function D() {}
D.prototype = new HoldsNumber();
console.log(above(A.prototype), above(B.prototype), above(C.prototype), above(D.prototype));
console.log(new A().label, new B().label, new C().own, new D().own, new A() instanceof Replaced, new B() instanceof Replaced);
console.log(above(new Replaced()), above(new HoldsNull()), above(new HoldsNumber()));
