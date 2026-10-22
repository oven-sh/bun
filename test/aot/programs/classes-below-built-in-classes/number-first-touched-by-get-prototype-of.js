// A class below Number is first touched by Object.getPrototypeOf.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Number {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("the parent", () => Object.getPrototypeOf(Late) === Number);
tell("an instance", () => {
  const one = new Late(5);
  return [one.valueOf() + 1, one instanceof Late, one instanceof Number, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Number].join(" ");
});
