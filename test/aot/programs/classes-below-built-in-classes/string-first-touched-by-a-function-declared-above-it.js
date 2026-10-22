// A class below String is first touched by a function that is declared above it and called below it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
function make() {
  return new Late("text");
}
class Late extends String {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = make();
  return [one.length + one.valueOf(), one instanceof Late, one instanceof String, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === String].join(" ");
});
