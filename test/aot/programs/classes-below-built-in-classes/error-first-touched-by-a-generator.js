// A class below Error is first touched by the body of a generator.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Error {
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
  return [one.message, one instanceof Late, one instanceof Error, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Error].join(" ");
});
