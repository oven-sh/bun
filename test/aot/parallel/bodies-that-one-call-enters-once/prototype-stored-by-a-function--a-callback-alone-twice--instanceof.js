const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
var kept, turn = 0;
function P(v) { this.v = v; }
function setUp() { turn++; P.prototype = { m: function () { return this.v + 1; } }; }
const tell = (when) => console.log(when, kept instanceof P, new P(1) instanceof P);
[0, 1].forEach(function () { if (kept === undefined && P.prototype.m) kept = new P(5); setUp(); });
tell("a");
