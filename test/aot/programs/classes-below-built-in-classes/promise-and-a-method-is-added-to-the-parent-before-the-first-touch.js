// Between the definition of a class below Promise and its first touch the prototype object of the built-in class gets a method.
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
Promise.prototype.added = function () {
  return "added to " + this.constructor.name;
};
tell("inherited", () => new Late(resolve => resolve(5)).added());
tell("an instance", () => {
  const one = new Late(resolve => resolve(5));
  return [typeof one.then, one instanceof Late, one instanceof Promise, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Promise].join(" ");
});
