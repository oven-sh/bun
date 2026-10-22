// Between the definition of a class below TypeError and its first touch the prototype object of the built-in class gets a method.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends TypeError {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
TypeError.prototype.added = function () {
  return "added to " + this.constructor.name;
};
tell("inherited", () => new Late("m").added());
tell("an instance", () => {
  const one = new Late("m");
  return [one.message + one.name, one instanceof Late, one instanceof TypeError, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === TypeError].join(" ");
});
