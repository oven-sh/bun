// The helper stores to its parameter, by name and through `arguments`, before it constructs by it.
function Base() { this.from = "Base"; }
function Swapped() { this.from = "Swapped"; }
function byName(Below, Above) {
  Above = Swapped;
  Below.prototype = new Above();
}
function throughArguments(Below, Above) {
  arguments[1] = Swapped;
  Below.prototype = new Above();
}
function sometimes(Below, Above, swaps) {
  if (swaps) Above = Swapped;
  Below.prototype = new Above();
}
function withDefault(Below, Above) {
  Above = Above || Swapped;
  Below.prototype = new Above();
}
function A() {} function B() {} function C() {} function D() {} function E() {} function F() {}
byName(A, Base);
throughArguments(B, Base);
sometimes(C, Base, true);
sometimes(D, Base, false);
withDefault(E, Base);
withDefault(F);
console.log(new A().from, new B().from, new C().from, new D().from, new E().from, new F().from);
