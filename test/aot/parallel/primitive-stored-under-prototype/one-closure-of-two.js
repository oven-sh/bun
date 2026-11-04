function make() { function Meter() { this.n = 1; } return Meter; }
const One = make(), Two = make();
One.prototype = null;
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(One.prototype), tell(Two.prototype), new One().n + new Two().n);
