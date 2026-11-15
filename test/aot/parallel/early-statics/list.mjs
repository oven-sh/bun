class Peg { constructor(size) { this.size = size; } next() { return new Peg(this.size + 1); } }
function same(value) { return value; }
class Base {}
Base.held = [1, 2, 3]; class Heir extends Base { static early = Heir.held; static held = "text"; } console.log(same(Heir.early).length, Heir.early[1] + 1, Heir.held.length);
