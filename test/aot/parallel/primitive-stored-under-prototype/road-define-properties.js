function Meter() { this.n = 1; }
Object.defineProperties(Meter, { prototype: { value: null } });
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(Meter.prototype));
