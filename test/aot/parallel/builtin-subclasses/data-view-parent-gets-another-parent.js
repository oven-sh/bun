// Between the definition of a class below DataView and its first touch the built-in class gets another prototype. A compiled executable refuses that: a built-in constructor keeps its prototype.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends DataView {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("another parent", () => Object.setPrototypeOf(DataView, { above: () => "above" }) === DataView);
tell("inherited", () => Late.above());
tell("an instance", () => {
  const one = new Late(new ArrayBuffer(8));
  return [one.byteLength, one instanceof Late, one instanceof DataView, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DataView].join(" ");
});
/* Output:
another parent threw TypeError
inherited threw TypeError
an instance 8 true true method of Late true true
*/
