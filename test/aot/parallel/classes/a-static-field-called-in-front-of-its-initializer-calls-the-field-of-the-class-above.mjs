class Base {
  static grow = value => value + 1;
}
class Heir extends Base {
  static early = Heir.grow(5);
  static grow = value => value + "t";
}
console.log(Heir.early, Heir.grow(5), Base.grow("a"));
