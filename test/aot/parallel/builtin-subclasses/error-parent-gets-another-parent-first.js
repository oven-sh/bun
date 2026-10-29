// Between the definition of a class below Error and its first touch the built-in class gets another prototype. A compiled executable refuses that: a built-in constructor keeps its prototype.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Error {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("another parent", () => Object.setPrototypeOf(Error, { above: () => "above" }) === Error);
tell("inherited", () => Late.above());
tell("an instance", () => {
  const one = new Late("m");
  return [one.message, one instanceof Late, one instanceof Error, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Error].join(" ");
});
/* Output:
another parent threw TypeError
inherited threw TypeError
an instance m true true method of Late true true
*/
