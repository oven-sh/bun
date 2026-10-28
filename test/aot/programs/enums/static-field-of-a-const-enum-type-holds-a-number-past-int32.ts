// The same rule holds for a const enum: a static field of its type is stored 2 ** 32.
const enum Mode {
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
const loose: number = 2 ** 32;
console.log(probe(loose));
