// Between the definition of a class below BigInt64Array and its first touch an error is thrown and caught.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends BigInt64Array {
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
  const one = new Late(1);
  return [one.length, one instanceof Late, one instanceof BigInt64Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === BigInt64Array].join(" ");
});
