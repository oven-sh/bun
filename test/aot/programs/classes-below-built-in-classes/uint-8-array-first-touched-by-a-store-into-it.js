// A class below Uint8Array is first touched by a store into it.
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
tell("the store", () => (Late.extra = 5));
tell("read back", () => Late.extra + Object.keys(Late).join());
tell("an instance", () => {
  const one = new Late(2);
  return [one.length, one instanceof Late, one instanceof Uint8Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Uint8Array].join(" ");
});
