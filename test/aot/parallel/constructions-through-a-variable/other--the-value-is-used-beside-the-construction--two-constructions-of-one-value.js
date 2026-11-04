const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function f(c) { const M = Maker; const a = c ? attempt(() => new M(1, 2).kind) : "none"; const b = attempt(() => new M(3, 4).kind); return a + " " + b; }
console.log(f(false), f(true)); start(); console.log(f(false), f(true));
