const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return typeof new K(1).m; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var K = (function () { function P(v) { this.v = v; } if (process.argv.length > 99) P.prototype.m = function () { return this.v + 1; }; return P; })(); show("a", K);
