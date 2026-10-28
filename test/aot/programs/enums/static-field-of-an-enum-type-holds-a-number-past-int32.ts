// TypeScript lets any number into a numeric enum. A static field of the enum's type is stored 2 ** 31 through a parameter of that type and read back.
enum Mode {
  Off,
  On,
}
class Shelf {
  static held: Mode = Mode.On;
}
function probe(v: Mode): string {
  Shelf.held = v;
  return typeof Shelf.held + " " + Shelf.held;
}
const loose = 2 ** 31;
console.log(probe(loose));
