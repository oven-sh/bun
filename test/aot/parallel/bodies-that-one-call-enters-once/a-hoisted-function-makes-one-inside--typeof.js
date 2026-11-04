const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return typeof new K(1).m; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var K = (function () { function P(v) { this.v = v; } early(); P.prototype.m = function () { return this.v + 1; }; return P; function early() { kept = new P(5); console.log(attempt(() => kept.m())); } })(); show("a", K);
