// An enum with a single member: a static field of its type is stored 7.
enum Mode {
  Only,
}
class Shelf {
  static held: Mode = Mode.Only;
}
function probe(v: Mode): string {
  Shelf.held = v;
  return typeof Shelf.held + " " + Shelf.held;
}
const loose: number = 7;
console.log(probe(loose));
