function Meter() { this.n = 1; }
function Gauge() { this.n = 2; }
function Dial() { this.n = 3; }
Meter.prototype &&= null;
Gauge.prototype ||= 5;
Dial.prototype ??= 5;
function tell(p) { let out = ""; for (let i = 0; i < 300; i++) out = p === null ? "null" : typeof p; return out; }
console.log(tell(Meter.prototype), tell(Gauge.prototype), tell(Dial.prototype));
