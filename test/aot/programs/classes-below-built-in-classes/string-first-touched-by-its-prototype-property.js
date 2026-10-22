// A class below String is first touched by a read of its prototype property.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends String {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("a method", () => Late.prototype.method.call({ constructor: { name: "nobody" } }));
tell("an instance", () => {
  const one = new Late("text");
  return [one.length + one.valueOf(), one instanceof Late, one instanceof String, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === String].join(" ");
});
