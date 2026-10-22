// Between the definition of a class below Date and its first touch the built-in class gets a static member.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Date {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
Date.added = () => "added";
tell("inherited", () => Late.added());
tell("an instance", () => {
  const one = new Late(0);
  return [one.getTime(), one instanceof Late, one instanceof Date, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Date].join(" ");
});
