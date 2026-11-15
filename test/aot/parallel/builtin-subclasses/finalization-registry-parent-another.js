// Between the definition of a class below FinalizationRegistry and its first touch the built-in class gets another prototype. A compiled executable refuses that: a built-in constructor keeps its prototype.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends FinalizationRegistry {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("another parent", () => Object.setPrototypeOf(FinalizationRegistry, { above: () => "above" }) === FinalizationRegistry);
tell("inherited", () => Late.above());
tell("an instance", () => {
  const one = new Late(() => {});
  return [typeof one.register, one instanceof Late, one instanceof FinalizationRegistry, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === FinalizationRegistry].join(" ");
});
/* Output:
another parent threw TypeError
inherited threw TypeError
an instance function true true method of Late true true
*/
