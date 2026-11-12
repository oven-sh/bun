class Peg {
  constructor(size) {
    this.size = size;
  }
  next() {
    return new Peg(this.size + 1);
  }
}
function same(value) {
  return value;
}
class Base {}
Base.held = new Peg(1);
Base.make = () => new Peg(4);
class Heir extends Base {
  static early = Heir.held;
  static made = Heir.make();
  static held = "text";
  static make = () => "made";
}
console.log(same(Heir.early).next().size, same(Heir.made).next().size, Heir.held, Heir.make());
