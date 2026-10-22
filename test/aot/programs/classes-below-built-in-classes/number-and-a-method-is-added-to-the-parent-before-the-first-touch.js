// Between the definition of a class below Number and its first touch the prototype object of the built-in class gets a method.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Number {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
Number.prototype.added = function () {
  return "added to " + this.constructor.name;
};
tell("inherited", () => new Late(5).added());
tell("an instance", () => {
  const one = new Late(5);
  return [one.valueOf() + 1, one instanceof Late, one instanceof Number, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Number].join(" ");
});
