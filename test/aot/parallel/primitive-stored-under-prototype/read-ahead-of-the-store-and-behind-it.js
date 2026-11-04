function Meter() { this.n = 1; }
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
const ahead = tell(Meter.prototype);
Meter.prototype = null;
console.log(ahead, tell(Meter.prototype));
