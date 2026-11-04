function Meter() { this.n = 1; }
Meter.prototype.show = function () { return this.n + 6; };
function Gauge() { this.n = 2; }
Gauge.prototype = Object.create(Meter.prototype);
function use(m) { let sum = 0; for (let i = 0; i < 300; i++) sum += m.show() + m.n; return sum; }
console.log(use(new Gauge()), use(new Meter()));
