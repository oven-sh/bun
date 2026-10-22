// A class below Iterator is first touched by the body of a generator.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Iterator {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
function* later() {
  yield new Late();
}
tell("an instance", () => {
  const one = later().next().value;
  return [typeof one.map, one instanceof Late, one instanceof Iterator, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Iterator].join(" ");
});
