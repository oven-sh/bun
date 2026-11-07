(globalThis.ran ??= []).push("values.cjs");
var base = 40;
class Kind {
  constructor(n) {
    this.n = n;
  }
  twice() {
    return this.n * 2;
  }
}
exports.number = 1;
exports.text = "a text";
exports.add = function (x) {
  return base + x;
};
exports.Kind = Kind;
