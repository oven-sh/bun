function Meter() { this.n = 1; }
const first = Meter.prototype;
Meter.prototype = true;
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === Object.prototype) hits++; return hits; }
function same(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === first) hits++; return hits; }
console.log(tell(new Meter().__proto__), same(new Meter().__proto__), tell(Object.getPrototypeOf(new Meter())));
