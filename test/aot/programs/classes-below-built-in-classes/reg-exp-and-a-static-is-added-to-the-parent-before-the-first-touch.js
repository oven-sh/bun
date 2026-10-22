// Between the definition of a class below RegExp and its first touch the built-in class gets a static member.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends RegExp {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
RegExp.added = () => "added";
tell("inherited", () => Late.added());
tell("an instance", () => {
  const one = new Late("a", "g");
  return [one.test("a") + one.flags, one instanceof Late, one instanceof RegExp, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === RegExp].join(" ");
});
