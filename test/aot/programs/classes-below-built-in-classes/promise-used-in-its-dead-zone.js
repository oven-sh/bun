// A class below Promise is used above its definition: a ReferenceError, whenever it is made.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
tell("too early", () => new Late(resolve => resolve(5)));
tell("too early", () => typeof Late);
class Late extends Promise {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = new Late(resolve => resolve(5));
  return [typeof one.then, one instanceof Late, one instanceof Promise, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Promise].join(" ");
});
