// A class below Map is first touched by Object.defineProperty on it.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Map {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("the definition", () => Object.defineProperty(Late, "extra", { value: 5 }).extra);
tell("an instance", () => {
  const one = new Late([[1, 2]]);
  return [one.size + one.get(1), one instanceof Late, one instanceof Map, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Map].join(" ");
});
