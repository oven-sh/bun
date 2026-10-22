// Between the definition of a class below DataView and its first touch the prototype object of the built-in class gets a method.
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
DataView.prototype.added = function () {
  return "added to " + this.constructor.name;
};
tell("inherited", () => new Late(new ArrayBuffer(8)).added());
tell("an instance", () => {
  const one = new Late(new ArrayBuffer(8));
  return [one.byteLength, one instanceof Late, one instanceof DataView, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DataView].join(" ");
});
