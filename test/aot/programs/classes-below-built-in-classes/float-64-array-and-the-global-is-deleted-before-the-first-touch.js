// Between the definition of a class below Float64Array and its first touch the global variable of the built-in class is deleted.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
const kept = Float64Array;
delete globalThis.Float64Array;
tell("an instance", () => {
  const one = new Late(2);
  return [one.length, one instanceof Late, one instanceof kept, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === kept].join(" ");
});
