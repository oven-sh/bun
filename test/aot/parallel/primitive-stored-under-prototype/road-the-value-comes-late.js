function Meter() { this.n = 1; }
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
const before = tell(Meter.prototype);
let held; held = null;
Meter.prototype = held;
console.log(before, tell(Meter.prototype));
