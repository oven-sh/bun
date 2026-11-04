const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function f() { const M = Maker; const o = attempt(() => new M(1, 2).kind); return o + " " + attempt(() => M.call({ }, 3, 4)) + " " + typeof M; }
console.log(f()); start(); console.log(f());
