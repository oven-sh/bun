// A class below Boolean is first touched by the definition of a class below it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Boolean {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
class Later extends Late {}
tell("below", () => [new Later(true) instanceof Late, Object.getPrototypeOf(Later) === Late, Later.fixed()].join(" "));
tell("an instance", () => {
  const one = new Late(true);
  return [one.valueOf(), one instanceof Late, one instanceof Boolean, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Boolean].join(" ");
});
