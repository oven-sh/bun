// Static methods store a number past the 32-bit integers to a static field of an enum's type through `this`, and read it through `this`.
enum Mode {
  Off,
  On,
}
class Shelf {
  static held: Mode = Mode.On;
  static put(v: Mode) {
    this.held = v;
    return this;
  }
  static read(): string {
    return typeof this.held + " " + this.held;
  }
}
const wide: number = 2 ** 32;
console.log(Shelf.put(wide).read(), Shelf.put(Mode.Off).read(), Shelf.put(wide + 1).read());
