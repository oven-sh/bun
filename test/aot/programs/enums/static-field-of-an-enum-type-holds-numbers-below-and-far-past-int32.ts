// A static field of a numeric enum's type is stored whole numbers on both sides of the 32-bit integers, and members in between.
enum Mode {
  Low = -5,
  High = 9,
}
class Shelf {
  static held: Mode = Mode.Low;
}
function probe(v: Mode): string {
  Shelf.held = v;
  return typeof Shelf.held + " " + Shelf.held;
}
const below: number = -(2 ** 31) - 1;
const past: number = 2 ** 32;
const far: number = 2 ** 53;
console.log(probe(below), probe(Mode.High), probe(past), probe(Mode.Low), probe(far));
