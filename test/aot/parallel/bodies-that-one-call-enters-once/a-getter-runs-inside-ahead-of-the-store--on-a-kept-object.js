const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return kept ? kept.m() : "none kept"; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var K = (function () { function P(v) { this.v = v; } var probe = { get now() { console.log(attempt(() => new P(5).m())); return 1; } }; probe.now; P.prototype.m = function () { return this.v + 1; }; return P; })(); show("a", K);
