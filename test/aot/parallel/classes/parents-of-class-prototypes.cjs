// COUNTER: ClassGuardBitsInvalidated <= 4
class Twig { constructor(rank, spot) { this.rank = rank; this.marks = 0; this.spot = spot; this.above = undefined; } begins() { return this.spot; } }
Object.setPrototypeOf(Twig.prototype, { base() { return 7 + this.rank; } });
function Token(rank, spot) { this.rank = rank; this.marks = 1; this.spot = spot; this.above = undefined; }
Token.prototype.begins = function () { return this.spot + 1; };
Object.setPrototypeOf(Token.prototype, null);
class Listener { constructor(rank, spot) { this.rank = rank; this.marks = 2; this.spot = spot; this.above = undefined; } begins() { return this.spot + 2; } }
require("util").inherits(Listener, require("events"));
class Above { base() { return 3; } }
class Below { constructor(rank, spot) { this.rank = rank; this.marks = 3; this.spot = spot; this.above = undefined; } begins() { return this.spot + 3; } }
Below.prototype.__proto__ = Above.prototype;
function create(rank, above) { const made = rank === 0 ? new Twig(rank, 1) : rank === 1 ? new Token(rank, 1) : rank === 2 ? new Listener(rank, 1) : new Below(rank, 1); made.above = above; return made; }
function depth(node) { let sum = 0; while (node) { if (node.rank === 3) sum++; sum += node.marks + node.begins(); node = node.above; } return sum; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let made; for (let k = 0; k < 8; k++) made = create(k & 3, made); sum += depth(made); } return sum; }
console.log(run(200), new Twig(5, 1).base(), typeof new Token(1, 1).toString, new Listener(1, 1).listenerCount("x"), new Below(1, 1).base(), new Below(1, 1) instanceof Above);
console.log(Object.keys(create(0)).join(), Object.keys(create(1)).join(), Object.keys(create(2)).join(), Object.keys(create(3)).join());
