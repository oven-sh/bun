// A class below Array is first touched by new.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Array {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new Late(3);
  return [one.length, one instanceof Late, one instanceof Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Array].join(" ");
});
