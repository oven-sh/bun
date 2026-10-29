// Between the definition of a class below RangeError and its first touch the built-in class gets another prototype. A compiled executable refuses that: a built-in constructor keeps its prototype.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends RangeError {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("another parent", () => Object.setPrototypeOf(RangeError, { above: () => "above" }) === RangeError);
tell("inherited", () => Late.above());
tell("an instance", () => {
  const one = new Late("m");
  return [one.message + one.name, one instanceof Late, one instanceof RangeError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === RangeError].join(" ");
});
/* Output:
another parent threw TypeError
inherited threw TypeError
an instance mRangeError true true method of Late true true
*/
