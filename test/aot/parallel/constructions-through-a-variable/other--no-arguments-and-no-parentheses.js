const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
console.log(attempt(() => new Maker), attempt(() => new Maker()));
start(); console.log((new Maker).kind, new Maker().pos, new Maker(1, 2, 3, 4).pos);
