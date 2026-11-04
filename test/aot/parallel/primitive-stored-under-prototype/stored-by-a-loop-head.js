function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
for (Meter.prototype of [null]) ;
for (Gauge.prototype in { a: 1 }) ;
function tell(p) { let out = ""; for (let i = 0; i < 300; i++) out = p === null ? "null" : typeof p; return out; }
console.log(tell(Meter.prototype), tell(Gauge.prototype));
