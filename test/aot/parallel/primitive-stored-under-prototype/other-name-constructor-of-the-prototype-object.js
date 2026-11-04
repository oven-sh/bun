function Meter() { this.n = 1; }
Meter.prototype.constructor = 7;
function use(m) { let out = ""; for (let i = 0; i < 300; i++) out = typeof m.constructor + ":" + (m.constructor === Meter); return out; }
console.log(use(new Meter()), typeof Meter.prototype.constructor);
