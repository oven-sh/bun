// A class below FinalizationRegistry is first touched by the body of a generator.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends FinalizationRegistry {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
function* later() {
  yield new Late(() => {});
}
tell("an instance", () => {
  const one = later().next().value;
  return [typeof one.register, one instanceof Late, one instanceof FinalizationRegistry, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === FinalizationRegistry].join(" ");
});
