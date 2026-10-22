// Between the definition of a class below AggregateError and its first touch an error is thrown and caught.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends AggregateError {
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
  const one = new Late([new Error("a")], "m");
  return [one.errors.length + one.message, one instanceof Late, one instanceof AggregateError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === AggregateError].join(" ");
});
