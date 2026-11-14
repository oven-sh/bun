class Peg { constructor(size) { this.size = size; } next() { return new Peg(this.size + 1); } }
function same(value) { return value; }
class Base {}
Base.n = 1.5; class Heir extends Base { static early = Heir.n; static n = 7; } console.log(same(Heir.early) + 1, typeof Heir.early, Heir.n + 1);
