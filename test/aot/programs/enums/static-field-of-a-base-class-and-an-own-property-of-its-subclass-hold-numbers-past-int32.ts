// A store through a subclass makes an own property of the subclass and leaves the static field of the base class alone. Both are then given numbers past the 32-bit integers.
enum Mode {
  Off,
  On,
}
class Shelf {
  static held: Mode = Mode.On;
}
class Rack extends Shelf {}
function put(v: Mode) {
  Rack.held = v;
}
const wide: number = 2 ** 31;
console.log(Rack.held, Shelf.held);
put(wide);
console.log(Rack.held, Shelf.held, Object.hasOwn(Rack, "held"));
Shelf.held = wide * 2;
console.log(Rack.held, Shelf.held);
