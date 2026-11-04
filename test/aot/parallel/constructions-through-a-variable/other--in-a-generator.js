const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function* make(k) { yield new Maker(k, 1).kind; yield new Maker(k + 1, 1).kind; }
console.log(attempt(() => [...make(1)].join())); start(); console.log([...make(2)].join());
