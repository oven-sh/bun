// A class below RangeError is used above its definition: a ReferenceError, whenever it is made.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("too early", () => new Late("m"));
tell("too early", () => typeof Late);
class Late extends RangeError {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new Late("m");
  return [one.message + one.name, one instanceof Late, one instanceof RangeError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === RangeError].join(" ");
});
