const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function f(n) { let t = ""; for (let i = 0; i < n; i++) { const M = Maker; t += typeof M + ","; if (i === 2) start(); if (i > 2) t += new M(i, 0).kind; } return t; }
console.log(f(6));
