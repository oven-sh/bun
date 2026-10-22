// A class below Promise is first touched by Object.defineProperty on it.
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
tell("the definition", () => Object.defineProperty(Late, "extra", { value: 5 }).extra);
tell("an instance", () => {
  const one = new Late(resolve => resolve(5));
  return [typeof one.then, one instanceof Late, one instanceof Promise, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Promise].join(" ");
});
