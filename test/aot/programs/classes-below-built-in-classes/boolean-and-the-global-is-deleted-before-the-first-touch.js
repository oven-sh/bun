// Between the definition of a class below Boolean and its first touch the global variable of the built-in class is deleted.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Boolean {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
const kept = Boolean;
delete globalThis.Boolean;
tell("an instance", () => {
  const one = new Late(true);
  return [one.valueOf(), one instanceof Late, one instanceof kept, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === kept].join(" ");
});
