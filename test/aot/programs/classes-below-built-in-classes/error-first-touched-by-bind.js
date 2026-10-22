// A class below Error is first touched by Function.prototype.bind.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Error {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("bound", () => Late.bind(null).name);
tell("an instance", () => {
  const one = new Late("m");
  return [one.message, one instanceof Late, one instanceof Error, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Error].join(" ");
});
