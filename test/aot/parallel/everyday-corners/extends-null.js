// Extends null: compiled answers as plain.
class N extends null {
  static s() {
    return "s";
  }
}
console.log(
  N.s(),
  Object.getPrototypeOf(N.prototype),
  (() => {
    try {
      new N();
    } catch (e) {
      return e.constructor.name;
    }
  })(),
);
