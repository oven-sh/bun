const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return typeof new K(1).m; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var K = (function (step) { function P(v) { this.v = v; } P.prototype.m = function () { return this.v + step; }; return P; })(1); show("a", K);
