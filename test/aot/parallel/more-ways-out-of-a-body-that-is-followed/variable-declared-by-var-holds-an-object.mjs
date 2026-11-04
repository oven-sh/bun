const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
var late;
function many() { let t = 0; for (let i = 0; i < 300; i++) t += late.v; return t; }
(function () {
  if (process.argv.length < 99) return note();
  late = new Gauge(7);
})();
console.log(attempt(many));
