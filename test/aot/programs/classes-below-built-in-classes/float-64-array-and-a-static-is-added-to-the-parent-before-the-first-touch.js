// Between the definition of a class below Float64Array and its first touch the built-in class gets a static member.
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
Float64Array.added = () => "added";
tell("inherited", () => Late.added());
tell("an instance", () => {
  const one = new Late(2);
  return [one.length, one instanceof Late, one instanceof Float64Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Float64Array].join(" ");
});
