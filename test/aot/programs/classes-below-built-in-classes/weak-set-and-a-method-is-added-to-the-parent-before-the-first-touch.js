// Between the definition of a class below WeakSet and its first touch the prototype object of the built-in class gets a method.
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
WeakSet.prototype.added = function () {
  return "added to " + this.constructor.name;
};
tell("inherited", () => new Late().added());
tell("an instance", () => {
  const one = new Late();
  return [one.has({}), one instanceof Late, one instanceof WeakSet, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === WeakSet].join(" ");
});
