// Between the definition of a class below Iterator and its first touch the built-in class gets another prototype. A compiled executable refuses that: a built-in constructor keeps its prototype.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Iterator {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("another parent", () => Object.setPrototypeOf(Iterator, { above: () => "above" }) === Iterator);
tell("inherited", () => Late.above());
tell("an instance", () => {
  const one = new Late();
  return [typeof one.map, one instanceof Late, one instanceof Iterator, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Iterator].join(" ");
});
/* Output:
another parent threw TypeError
inherited threw TypeError
an instance function true true method of Late true true
*/
