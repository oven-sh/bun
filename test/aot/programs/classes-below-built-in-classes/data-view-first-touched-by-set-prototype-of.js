// A class below DataView is first touched by Object.setPrototypeOf, which gives it another parent.
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
class Other {
  static other() {
    return "other";
  }
}
tell("another parent", () => Object.setPrototypeOf(Late, Other).other());
tell("an instance", () => new Late(new ArrayBuffer(8)) instanceof Late);
