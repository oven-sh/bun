// A class below WeakSet is first touched by a conversion to a text.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends WeakSet {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("the text", () => String(Late).replace(/\s+/g, " ").slice(0, 24));
tell("an instance", () => {
  const one = new Late();
  return [one.has({}), one instanceof Late, one instanceof WeakSet, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === WeakSet].join(" ");
});
