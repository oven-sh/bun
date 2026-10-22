// Between the definition of a class below FinalizationRegistry and its first touch the global variable of the built-in class is given another value.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends FinalizationRegistry {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
const kept = FinalizationRegistry;
globalThis.FinalizationRegistry = class Impostor {};
tell("an instance", () => {
  const one = new Late(() => {});
  return [typeof one.register, one instanceof Late, one instanceof kept, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === kept].join(" ");
});
