function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
Meter.prototype = null;
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
let sum = 0;
for (const f of [Meter, Gauge]) sum += tell(f.prototype);
console.log(sum);
