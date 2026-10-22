// A class below Map is first touched by an object literal that holds it, read under a key that is put together at run time.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Map {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
const table = { Late };
tell("an instance", () => {
  const one = new table[["La", "te"].join("")]([[1, 2]]);
  return [one.size + one.get(1), one instanceof Late, one instanceof Map, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Map].join(" ");
});
