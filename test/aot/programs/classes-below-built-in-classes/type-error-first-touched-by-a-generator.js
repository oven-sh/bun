// A class below TypeError is first touched by the body of a generator.
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
function* later() {
  yield new Late("m");
}
tell("an instance", () => {
  const one = later().next().value;
  return [one.message + one.name, one instanceof Late, one instanceof TypeError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === TypeError].join(" ");
});
