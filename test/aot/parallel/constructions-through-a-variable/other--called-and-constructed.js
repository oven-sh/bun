const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
start();
const holder = { m: Maker };
console.log(attempt(() => Maker(1, 2)), holder.m(3, 4), holder.kind, new Maker(5, 6).kind);
