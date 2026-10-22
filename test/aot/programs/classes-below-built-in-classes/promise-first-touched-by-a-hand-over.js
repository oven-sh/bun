// A class below Promise is first touched by a hand-over to a function.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Promise {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("an instance", () => {
  const one = (made => new made(resolve => resolve(5)))(Late);
  return [typeof one.then, one instanceof Late, one instanceof Promise, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Promise].join(" ");
});
