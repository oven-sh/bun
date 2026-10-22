// A class below Object is first touched by nothing at all: only the class below it in the text is used.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Object {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
class Used extends Object {}
tell("the other class", () => [new Used() instanceof Object, Used.name].join(" "));
