// Between the definition of a class below FinalizationRegistry and its first touch an error is thrown and caught.
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
try {
  null.x;
} catch {}
tell("an instance", () => {
  const one = new Late(() => {});
  return [typeof one.register, one instanceof Late, one instanceof FinalizationRegistry, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === FinalizationRegistry].join(" ");
});
