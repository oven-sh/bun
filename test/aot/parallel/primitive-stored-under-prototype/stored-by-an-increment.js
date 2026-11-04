function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
Meter.prototype++;
Gauge.prototype += 1;
function tell(p) { let out = ""; for (let i = 0; i < 300; i++) out = typeof p + ":" + (p !== p); return out; }
console.log(tell(Meter.prototype), tell(Gauge.prototype));
