// Between the definition of a class below DisposableStack and its first touch the built-in class gets another prototype. A compiled executable refuses that: a built-in constructor keeps its prototype.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends DisposableStack {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("another parent", () => Object.setPrototypeOf(DisposableStack, { above: () => "above" }) === DisposableStack);
tell("inherited", () => Late.above());
tell("an instance", () => {
  const one = new Late();
  return [one.disposed, one instanceof Late, one instanceof DisposableStack, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DisposableStack].join(" ");
});
/* Output:
another parent threw TypeError
inherited threw TypeError
an instance false true true method of Late true true
*/
