// A class below WeakMap is first touched by Reflect.construct of the built-in class, whose new target it is.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends WeakMap {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = Reflect.construct(WeakMap, [], Late);
  return [one.has({}), one instanceof Late, one instanceof WeakMap, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === WeakMap].join(" ");
});
