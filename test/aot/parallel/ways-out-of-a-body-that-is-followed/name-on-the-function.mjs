const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read() { let t = 0; for (let i = 0; i < 200; i++) t += Gauge.step(i & 3); return t; }
(function () {
  if (process.argv.length < 99) return note();
  Gauge.step = function (v) { return v + 1; };
})();
console.log(attempt(read));
