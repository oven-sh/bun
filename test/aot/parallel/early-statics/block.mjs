class Peg { constructor(size) { this.size = size; } next() { return new Peg(this.size + 1); } }
function same(value) { return value; }
class Base {}
Base.held = new Peg(1); class Heir extends Base { static early; static { Heir.early = Heir.held; } static held = "text"; } console.log(same(Heir.early).next().size, Heir.held);
