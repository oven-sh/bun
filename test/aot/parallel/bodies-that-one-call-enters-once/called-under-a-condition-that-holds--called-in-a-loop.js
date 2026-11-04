const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { let t = 0; for (let i = 0; i < 20; i++) t += new K(i & 3).m(); return t; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
function P(v) { this.v = v; } if (process.argv.length < 99) (function () { P.prototype.m = function () { return this.v + 1; }; })(); show("a", P);
