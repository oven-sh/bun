// A class below Error is first touched by nothing at all: only the class below it in the text is used.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Error {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
class Used extends Error {}
tell("the other class", () => [new Used("m") instanceof Error, Used.name].join(" "));
