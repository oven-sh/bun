const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
(function () {
  if (process.argv.length < 99) return note();
  Gauge.step = function (v) { return v + 1; };
})();
function many() { let out = ''; for (let i = 0; i < 300; i++) out = typeof Gauge.step + ':' + ('step' in Gauge); return out; }
console.log(attempt(many));
