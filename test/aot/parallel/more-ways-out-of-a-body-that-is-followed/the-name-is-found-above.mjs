const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Base() { }
Base.prototype.next = function () { return -1; };
function Gauge(v) { this.v = v; }
Object.setPrototypeOf(Gauge.prototype, Base.prototype);
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype.next = function () { return this.v + 1; };
})();
console.log(attempt(() => read(Gauge)));
