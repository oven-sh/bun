// A static field that holds a numeric enum or undefined starts undefined and is stored 2 ** 31.
enum Mode {
  Off,
  On,
}
class Shelf {
  static held: Mode | undefined = undefined;
}
function probe(v: Mode): string {
  Shelf.held = v;
  return typeof Shelf.held + " " + Shelf.held;
}
console.log(typeof Shelf.held);
const loose: number = 2 ** 31;
console.log(probe(loose));
