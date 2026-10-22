// A class below RegExp is first touched by a store into it.
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
tell("the store", () => (Late.extra = 5));
tell("read back", () => Late.extra + Object.keys(Late).join());
tell("an instance", () => {
  const one = new Late("a", "g");
  return [one.test("a") + one.flags, one instanceof Late, one instanceof RegExp, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === RegExp].join(" ");
});
