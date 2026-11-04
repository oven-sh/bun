function Meter() { this.n = 1; }
const kept = Meter.prototype;
Meter.prototype = null; const between = Meter.prototype; Meter.prototype = kept;
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(between), tell(Meter.prototype), new Meter() instanceof Meter);
