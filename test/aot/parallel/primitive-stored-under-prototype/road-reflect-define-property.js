function Meter() { this.n = 1; }
Reflect.defineProperty(Meter, "prototype", { value: true });
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === true) hits++; return hits; }
console.log(tell(Meter.prototype));
