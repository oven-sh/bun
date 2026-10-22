// A class below Uint8Array is used above its definition: a ReferenceError, whenever it is made.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("too early", () => new Late(2));
tell("too early", () => typeof Late);
class Late extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new Late(2);
  return [one.length, one instanceof Late, one instanceof Uint8Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Uint8Array].join(" ");
});
