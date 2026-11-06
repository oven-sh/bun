// An object leaves the constructor through an initializer that throws in front of the value of an `accessor` field. It has the getter and the setter of the field, and no value to read
const lines = [];
let left;
class Leaks {
  first = (left = this);
  second = fail();
  accessor #gauge = 1;
  static has(value) {
    return #gauge in value;
  }
  static read(value) {
    return value.#gauge;
  }
  static store(value) {
    value.#gauge = 2;
    return value.#gauge;
  }
}
function fail() {
  throw new RangeError("the second field fails");
}
function attempt(label, run) {
  try {
    lines.push(label + ": " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.constructor.name);
  }
}
attempt("the constructor", () => new Leaks());
attempt("has", () => Leaks.has(left));
attempt("read", () => Leaks.read(left));
attempt("store", () => Leaks.store(left));
attempt("has, an object of no class", () => Leaks.has({}));
console.log(lines.join("\n"));
