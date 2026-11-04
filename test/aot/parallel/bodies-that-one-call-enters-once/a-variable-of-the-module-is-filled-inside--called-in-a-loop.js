const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { let t = 0; for (let i = 0; i < 20; i++) t += new K(i & 3).m(); return t; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var filled; function use() { return typeof filled + " " + filled; } console.log(use()); (function () { filled = 5; })(); console.log(use()); var K = function (v) { this.v = v; }; K.prototype.m = function () { return this.v + 1; }; show("a", K);
