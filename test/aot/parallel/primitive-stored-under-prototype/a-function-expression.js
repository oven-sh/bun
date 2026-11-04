const Meter = function () { this.n = 1; };
Meter.prototype = undefined;
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === undefined) hits++; return hits; }
console.log(tell(Meter.prototype), new Meter().n);
