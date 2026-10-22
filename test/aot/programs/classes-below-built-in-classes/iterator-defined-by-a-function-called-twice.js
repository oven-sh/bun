// A class below Iterator is defined in a function that is called twice: each call makes a class of its own.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
function define() {
  class Late extends Iterator {
    method() {
      return "method of " + this.constructor.name;
    }
    static fixed() {
      return "static of " + this.name;
    }
  }
  return Late;
}
const first = define();
const second = define();
tell("two classes", () => [first === second, new first() instanceof second, new second() instanceof second, first.fixed()].join(" "));
