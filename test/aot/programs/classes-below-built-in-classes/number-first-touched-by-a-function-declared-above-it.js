// A class below Number is first touched by a function that is declared above it and called below it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
function make() {
  return new Late(5);
}
class Late extends Number {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = make();
  return [one.valueOf() + 1, one instanceof Late, one instanceof Number, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Number].join(" ");
});
