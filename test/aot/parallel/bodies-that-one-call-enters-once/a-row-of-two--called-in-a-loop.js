const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { let t = 0; for (let i = 0; i < 20; i++) t += new K(i & 3).m(); return t; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
var Base = (function () { function Base(v) { this.v = v; } Base.prototype.m = function () { return this.v + 1; }; return Base; })(); var K = (function (_super) { function P(v) { _super.call(this, v); } P.prototype = Object.create(_super.prototype); return P; })(Base); show("a", K); show("b", Base);
