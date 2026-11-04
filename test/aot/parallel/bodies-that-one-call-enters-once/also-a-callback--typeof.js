const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return typeof new K(1).m; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
function P(v) { this.v = v; } var turn = 0; function setUp() { P.prototype.m = turn++ ? function () { return this.v + 100; } : function () { return this.v + 1; }; } setUp(); show("a", P); [0].forEach(setUp); show("b", P);
