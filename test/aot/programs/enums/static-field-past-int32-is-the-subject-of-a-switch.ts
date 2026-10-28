// A switch over a static field of an enum's type takes its default when the field holds 2 ** 32 + 1, whose low 32 bits are those of a member.
enum Mode {
  Off,
  On,
  Auto,
}
class Shelf {
  static held: Mode = Mode.On;
}
function name(): string {
  switch (Shelf.held) {
    case Mode.Off:
      return "off";
    case Mode.On:
      return "on";
    case Mode.Auto:
      return "auto";
    default:
      return "other " + Shelf.held;
  }
}
function put(v: Mode) {
  Shelf.held = v;
}
console.log(name());
const wide: number = 2 ** 32 + 1;
put(wide);
console.log(name());
