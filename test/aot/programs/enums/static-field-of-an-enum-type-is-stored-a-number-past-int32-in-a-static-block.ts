// A static block reads a static field of an enum's type and then stores a number below the 32-bit integers to it.
enum Mode {
  Off,
  On,
}
const loose: number = -(2 ** 31) - 1;
class Shelf {
  static held: Mode = Mode.On;
  static first: string;
  static {
    Shelf.first = typeof Shelf.held + " " + Shelf.held;
    Shelf.held = loose;
  }
}
console.log(Shelf.first, typeof Shelf.held, Shelf.held);
