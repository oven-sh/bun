// A class below DataView is first touched by Object.getOwnPropertyNames.
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
tell("its names", () => Object.getOwnPropertyNames(Late).sort().join());
tell("the names of its prototype property", () => Object.getOwnPropertyNames(Late.prototype).sort().join());
tell("an instance", () => {
  const one = new Late(new ArrayBuffer(8));
  return [one.byteLength, one instanceof Late, one instanceof DataView, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DataView].join(" ");
});
