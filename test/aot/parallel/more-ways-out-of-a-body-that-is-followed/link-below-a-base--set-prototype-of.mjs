const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
function Base() { }
Base.prototype.next = function () { return this.v + 100; };
(function () {
  if (process.argv.length < 99) return note();
  Object.setPrototypeOf(Gauge.prototype, Base.prototype);
})();
function many() { let t = 0; for (let i = 0; i < 300; i++) { const g = new Gauge(i & 3); t += (g instanceof Base ? 1000 : 0) + (typeof g.next === 'function' ? g.next() : -1); } return t; }
console.log(attempt(many));
