class Peg { constructor(size) { this.size = size; } next() { return new Peg(this.size + 1); } }
function same(value) { return value; }
class Base {}
Base.make = () => new Peg(4); class Heir extends Base { static made = Heir.make(); static make = () => "made"; } console.log(typeof Heir.made, same(Heir.made).size, Heir.make());
