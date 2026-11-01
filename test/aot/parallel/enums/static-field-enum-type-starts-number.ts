// The initializer of a static field of an enum's type is a number past the 32-bit integers, and the next static field is computed from it.
enum Mode {
  Off,
  On,
}
const loose: number = 2 ** 31;
class Shelf {
  static held: Mode = loose;
  static next: Mode = Shelf.held + 1;
}
console.log(typeof Shelf.held, Shelf.held, typeof Shelf.next, Shelf.next);
