function Meter() { this.n = 1; }
Meter.prototype = JSON.parse("true") ? null : { show() { return 1; } };
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(Meter.prototype), typeof new Meter().show);
