const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read() { let out = ''; for (let i = 0; i < 200; i++) out = typeof new Gauge(i).next; return out; }
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype.next = function () { return this.v + 1; };
})();
console.log(attempt(read));
