// A class below Uint8Array is first touched by Reflect.construct of the built-in class, whose new target it is.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = Reflect.construct(Uint8Array, [2], Late);
  return [one.length, one instanceof Late, one instanceof Uint8Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Uint8Array].join(" ");
});
