// Static block sees private: compiled answers as plain.
class A {
  static #count = 0;
  static inc;
  static {
    A.inc = () => ++A.#count;
  }
}
console.log(A.inc(), A.inc());
