class Peg {
  constructor(size) {
    this.size = size;
  }
}
const shown = value => (typeof value === "object" ? "Peg " + value.size : String(value));
class Base {
  static held = 1;
}
class Heir extends Base {
  static seen = [];
  static {
    Heir.seen.push(Heir.held);
  }
  static held = new Peg(2);
  static {
    Heir.seen.push(Heir.held);
  }
}
console.log(Heir.seen.map(shown).join());
