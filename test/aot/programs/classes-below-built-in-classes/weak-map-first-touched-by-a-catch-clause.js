// A class below WeakMap is first touched by a throw of an instance.
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
tell("caught", () => {
  try {
    throw new Late();
  } catch (caught) {
    return caught instanceof Late;
  }
});
tell("an instance", () => {
  const one = new Late();
  return [one.has({}), one instanceof Late, one instanceof WeakMap, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === WeakMap].join(" ");
});
