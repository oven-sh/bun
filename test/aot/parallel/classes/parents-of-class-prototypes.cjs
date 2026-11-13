// COUNTER: ClassGuardBitsInvalidated <= 4
class Node4 { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 0; this.parent = undefined; } getStart() { return this.pos; } }
Object.setPrototypeOf(Node4.prototype, { base() { return 7 + this.kind; } });
function Token(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 1; this.parent = undefined; }
Token.prototype.getStart = function () { return this.pos + 1; };
Object.setPrototypeOf(Token.prototype, null);
class Listener { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 2; this.parent = undefined; } getStart() { return this.pos + 2; } }
require("util").inherits(Listener, require("events"));
class Above { base() { return 3; } }
class Below { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 3; this.parent = undefined; } getStart() { return this.pos + 3; } }
Below.prototype.__proto__ = Above.prototype;
function create(kind, parent) { const made = kind === 0 ? new Node4(kind, 1) : kind === 1 ? new Token(kind, 1) : kind === 2 ? new Listener(kind, 1) : new Below(kind, 1); made.parent = parent; return made; }
function depth(node) { let sum = 0; while (node) { if (node.kind === 3) sum++; sum += node.flags + node.getStart(); node = node.parent; } return sum; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let made; for (let k = 0; k < 8; k++) made = create(k & 3, made); sum += depth(made); } return sum; }
console.log(run(200), new Node4(5, 1).base(), typeof new Token(1, 1).toString, new Listener(1, 1).listenerCount("x"), new Below(1, 1).base(), new Below(1, 1) instanceof Above);
console.log(Object.keys(create(0)).join(), Object.keys(create(1)).join(), Object.keys(create(2)).join(), Object.keys(create(3)).join());
