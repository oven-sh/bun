// A static field of an enum's type is read by arithmetic, by operators on bits, by comparisons and as an index, while it holds a member and while it holds a number on either side of the 32-bit integers.
enum Mode {
  Off,
  On,
}
class Shelf {
  static held: Mode = Mode.On;
}
function put(v: Mode) {
  Shelf.held = v;
}
function use(): string {
  return [
    Shelf.held + 1,
    Shelf.held | 0,
    Shelf.held >> 1,
    Shelf.held === Mode.On,
    Shelf.held > 5,
    -Shelf.held,
    Shelf.held % 7,
    [10, 20][Shelf.held],
  ].join();
}
console.log(use());
const wide: number = 2 ** 31;
put(wide);
console.log(use());
put(-wide - 1);
console.log(use());
