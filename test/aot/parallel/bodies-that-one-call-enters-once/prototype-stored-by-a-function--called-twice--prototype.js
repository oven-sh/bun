const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
var kept, turn = 0;
function P(v) { this.v = v; }
function setUp() { turn++; P.prototype = { m: function () { return this.v + 1; } }; }
const tell = (when) => console.log(when, Object.getPrototypeOf(kept) === P.prototype);
setUp(); kept = new P(5); setUp();
tell("a");
