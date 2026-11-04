const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
const unseen = (0, eval)('(x) => x');
(function () {
  if (process.argv.length < 99) return unseen(1);
  Gauge.prototype.next = function () { return this.v + 1; };
})();
console.log(attempt(() => read(Gauge)));
