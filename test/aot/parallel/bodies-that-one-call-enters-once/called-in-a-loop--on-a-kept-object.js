const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return kept ? kept.m() : "none kept"; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var all = []; for (var i = 0; i < 2; i++) all.push((function (i) { function P(v) { this.v = v; } if (i === 0) P.prototype.m = function () { return this.v + 1; }; return P; })(i)); show("a", all[0]); show("b", all[1]);
