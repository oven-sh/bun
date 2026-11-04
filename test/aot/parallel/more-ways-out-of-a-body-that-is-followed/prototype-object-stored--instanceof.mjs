const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
const first = Gauge.prototype;
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype = { next() { return this.v + 1; } };
})();
function many() { let n = 0; for (let i = 0; i < 300; i++) { const g = new Gauge(i); n += (Object.getPrototypeOf(g) === first ? 1 : 0) + (g instanceof Gauge ? 2 : 0) + (typeof g.next === 'function' ? 4 : 0); } return n; }
console.log(attempt(many));
