// A class below ArrayBuffer is first touched by the definition of a class below it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends ArrayBuffer {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
class Later extends Late {}
tell("below", () => [new Later(8) instanceof Late, Object.getPrototypeOf(Later) === Late, Later.fixed()].join(" "));
tell("an instance", () => {
  const one = new Late(8);
  return [one.byteLength, one instanceof Late, one instanceof ArrayBuffer, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === ArrayBuffer].join(" ");
});
