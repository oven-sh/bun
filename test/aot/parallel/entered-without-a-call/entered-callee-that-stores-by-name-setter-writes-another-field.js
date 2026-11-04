// A callee stores under a name that a setter of the class answers to, the setter writes another field, and the caller looks at that field before and behind.
class Gauge { constructor() { this.w = 0; } set v(x) { this.w = this.w + x; } }
function middle(c, x) { c.v = x; }
function outer(c) { const before = c.w; middle(c, 5); const behind = c.w; return before + ">" + behind; }
function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, 1); s += c.w + ","; } return s; }
console.log(outer(new Gauge()), looped(new Gauge()));
