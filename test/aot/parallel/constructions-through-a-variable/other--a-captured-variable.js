const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
function outer() { var Maker; return { start() { Maker = Node; }, make(k) { return new Maker(k, 1).kind; } }; }
const o = outer();
console.log(attempt(() => o.make(1))); o.start(); console.log(o.make(2));
