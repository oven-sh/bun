// A class below Date is first touched by the body of a generator.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Date {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
function* later() {
  yield new Late(0);
}
tell("an instance", () => {
  const one = later().next().value;
  return [one.getTime(), one instanceof Late, one instanceof Date, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Date].join(" ");
});
