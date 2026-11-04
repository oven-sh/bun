const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function f(c) { const M = Maker; let made = 0; if (c) made = attempt(() => new M(1, 2).kind); return typeof M + " " + made; }
console.log(f(false), f(true)); start(); console.log(f(false), f(true));
