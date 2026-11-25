const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Pair(a, b) { if (!(this instanceof Pair)) return new Pair(a, b); this.a = a; this.b = b; }
Pair.prototype.sum = function () { return this.a + this.b; };
function run(n) { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? Pair(i & 7, 1) : new Pair(i & 3, 2); t += p.sum(); } return t; }
console.log(run(40));
