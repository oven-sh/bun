// A static field that holds a numeric enum or a string is stored 2 ** 31.
enum Mode {
  Off,
  On,
}
class Shelf {
  static held: Mode | string = "x";
}
function probe(v: Mode): string {
  Shelf.held = v;
  return typeof Shelf.held + " " + Shelf.held;
}
const loose: number = 2 ** 31;
console.log(probe(loose));
