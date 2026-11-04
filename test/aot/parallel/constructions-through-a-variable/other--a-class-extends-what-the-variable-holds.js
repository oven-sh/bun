const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
console.log(attempt(() => { class B extends Maker { } return new B(1, 2).kind; }));
start();
class B extends Maker { constructor(k) { super(k, 9); this.below = 1; } }
console.log(Object.keys(new B(4)).join(), new B(4) instanceof Node);
