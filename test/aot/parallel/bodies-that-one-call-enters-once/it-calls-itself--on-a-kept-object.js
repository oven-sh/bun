const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return kept ? kept.m() : "none kept"; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
function P(v) { this.v = v; } (function again(n) { if (n) { kept = new P(5); again(n - 1); return; } P.prototype.m = function () { return this.v + 1; }; })(1); show("a", P);
