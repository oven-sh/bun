// A class below DataView is first touched by a hand-over to a function.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends DataView {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = (made => new made(new ArrayBuffer(8)))(Late);
  return [one.byteLength, one instanceof Late, one instanceof DataView, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DataView].join(" ");
});
