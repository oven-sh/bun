// Between the definition of a class below Set and its first touch the collector runs.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Set {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
Bun.gc(true);
tell("an instance", () => {
  const one = new Late([1, 2]);
  return [one.size, one instanceof Late, one instanceof Set, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Set].join(" ");
});
