function Meter() { this.n = 1; }
Meter.prototype = { show() { return this.n + 6; } };
function use(m) { let sum = 0; for (let i = 0; i < 300; i++) sum += m.show() + m.n; return sum; }
console.log(use(new Meter()), typeof Meter.prototype);
