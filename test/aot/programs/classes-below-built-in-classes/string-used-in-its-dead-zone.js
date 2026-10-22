// A class below String is used above its definition: a ReferenceError, whenever it is made.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("too early", () => new Late("text"));
tell("too early", () => typeof Late);
class Late extends String {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new Late("text");
  return [one.length + one.valueOf(), one instanceof Late, one instanceof String, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === String].join(" ");
});
