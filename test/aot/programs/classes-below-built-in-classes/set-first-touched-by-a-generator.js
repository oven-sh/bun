// A class below Set is first touched by the body of a generator.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Set {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
function* later() {
  yield new Late([1, 2]);
}
tell("an instance", () => {
  const one = later().next().value;
  return [one.size, one instanceof Late, one instanceof Set, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Set].join(" ");
});
