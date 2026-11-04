const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Gauge(v) { this.v = v; }
function note() { return 0; }
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
function Base() { }
Base.prototype.next = function () { return this.v + 100; };
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype = Object.create(Base.prototype);
})();
function many() { let t = 0; for (let i = 0; i < 300; i++) t += new Gauge(i & 3).next(); return t; }
console.log(attempt(many));
