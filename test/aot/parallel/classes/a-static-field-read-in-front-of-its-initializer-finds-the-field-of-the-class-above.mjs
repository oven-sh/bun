class Peg {
  constructor(size) {
    this.size = size;
  }
  next() {
    return new Peg(this.size + 1);
  }
}
class Base {
  static held = new Peg(1);
}
class Heir extends Base {
  static early = Heir.held;
  static held = "text";
  static get() {
    return Heir.early;
  }
}
console.log(Heir.get().size, Heir.get().next().size, Heir.held);
