const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return typeof new K(1).m; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var turn = 0; var make = function () { function P(v) { this.v = v; } if (turn++ === 0) P.prototype.m = function () { return this.v + 1; }; return P; }; var A = make(), B = make(); show("a", A); show("b", B);
