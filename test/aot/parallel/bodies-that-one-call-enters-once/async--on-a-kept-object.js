const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return kept ? kept.m() : "none kept"; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
function P(v) { this.v = v; } (async function () { await null; P.prototype.m = function () { return this.v + 1; }; show("later", P); })(); show("a", P);
