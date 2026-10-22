// A class below ArrayBuffer is first touched by the body of a generator.
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
function* later() {
  yield new Late(8);
}
tell("an instance", () => {
  const one = later().next().value;
  return [one.byteLength, one instanceof Late, one instanceof ArrayBuffer, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === ArrayBuffer].join(" ");
});
