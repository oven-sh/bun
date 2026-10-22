// A class below FinalizationRegistry is first touched by the definition of a class below it.
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
class Later extends Late {}
tell("below", () => [new Later(() => {}) instanceof Late, Object.getPrototypeOf(Later) === Late, Later.fixed()].join(" "));
tell("an instance", () => {
  const one = new Late(() => {});
  return [typeof one.register, one instanceof Late, one instanceof FinalizationRegistry, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === FinalizationRegistry].join(" ");
});
