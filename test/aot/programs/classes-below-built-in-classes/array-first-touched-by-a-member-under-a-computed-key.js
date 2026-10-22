// A class below Array is first touched by an object literal that holds it, read under a key that is put together at run time.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Array {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
const table = { Late };
tell("an instance", () => {
  const one = new table[["La", "te"].join("")](3);
  return [one.length, one instanceof Late, one instanceof Array, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Array].join(" ");
});
