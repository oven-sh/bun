// Between the definition of a class below RegExp and its first touch the global variable of the built-in class is given another value.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends RegExp {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
const kept = RegExp;
globalThis.RegExp = class Impostor {};
tell("an instance", () => {
  const one = new Late("a", "g");
  return [one.test("a") + one.flags, one instanceof Late, one instanceof kept, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === kept].join(" ");
});
