const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { return kept ? kept.m() : "none kept"; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
function P(v) { this.v = v; } var turn = 0; function setUp() { P.prototype.m = turn++ ? function () { return this.v + 100; } : function () { return this.v + 1; }; return 1; } var o = { get g() { return setUp(); } }; setUp(); show("a", P); o.g; show("b", P);
