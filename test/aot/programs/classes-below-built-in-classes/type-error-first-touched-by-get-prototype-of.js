// A class below TypeError is first touched by Object.getPrototypeOf.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends TypeError {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("the parent", () => Object.getPrototypeOf(Late) === TypeError);
tell("an instance", () => {
  const one = new Late("m");
  return [one.message + one.name, one instanceof Late, one instanceof TypeError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === TypeError].join(" ");
});
