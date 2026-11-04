const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function Base() {}
Base.prototype.next = function () { return this.v + 100; };
function read(K) { let t = 0; for (let i = 0; i < 200; i++) t += new K(i & 3).next(); return t; }
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype = Object.create(Base.prototype);
})();
console.log(attempt(() => read(Gauge)));
