// A class below BigInt64Array is first touched by a hand-over to a function.
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
tell("an instance", () => {
  const one = (made => new made(1))(Late);
  return [one.length, one instanceof Late, one instanceof BigInt64Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === BigInt64Array].join(" ");
});
