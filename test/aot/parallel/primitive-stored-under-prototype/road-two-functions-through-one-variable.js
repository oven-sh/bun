function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
for (const f of [Meter, Gauge]) f.prototype = null;
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(Meter.prototype), tell(Gauge.prototype));
