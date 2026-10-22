// A class below Float64Array is first touched by the definition of a class below it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
class Later extends Late {}
tell("below", () => [new Later(2) instanceof Late, Object.getPrototypeOf(Later) === Late, Later.fixed()].join(" "));
tell("an instance", () => {
  const one = new Late(2);
  return [one.length, one instanceof Late, one instanceof Float64Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Float64Array].join(" ");
});
