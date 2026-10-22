// A class below Boolean is first touched by a proxy around it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Boolean {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new (new Proxy(Late, {}))(true);
  return [one.valueOf(), one instanceof Late, one instanceof Boolean, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Boolean].join(" ");
});
