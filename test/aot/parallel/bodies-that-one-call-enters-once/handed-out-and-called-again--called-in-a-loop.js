const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { let t = 0; for (let i = 0; i < 20; i++) t += new K(i & 3).m(); return t; }
var kept;
const show = (when, K) => console.log(when, attempt(() => read(K)));
function P(v) { this.v = v; } var turn = 0; function setUp() { P.prototype.m = turn++ ? function () { return this.v + 100; } : function () { return this.v + 1; }; } globalThis["ke" + "pt"] = setUp; setUp(); show("a", P); globalThis["ke" + "pt"](); show("b", P);
