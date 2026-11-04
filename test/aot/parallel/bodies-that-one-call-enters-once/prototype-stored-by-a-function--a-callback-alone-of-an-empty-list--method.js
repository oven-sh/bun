const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
var kept, turn = 0;
function P(v) { this.v = v; }
function setUp() { turn++; P.prototype = { m: function () { return this.v + 1; } }; }
const tell = (when) => console.log(when, attempt(() => kept.m()), attempt(() => new P(1).m()));
[].forEach(setUp); kept = new P(5);
tell("a");
