// A class below RegExp is used above its definition: a ReferenceError, whenever it is made.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("too early", () => new Late("a", "g"));
tell("too early", () => typeof Late);
class Late extends RegExp {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new Late("a", "g");
  return [one.test("a") + one.flags, one instanceof Late, one instanceof RegExp, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === RegExp].join(" ");
});
