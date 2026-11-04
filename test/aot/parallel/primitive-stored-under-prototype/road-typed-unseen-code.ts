interface Counted { n: number; }
function Meter(this: Counted) { this.n = 1; }
(0, eval)("(f) => { f.prototype = 2.5; }")(Meter);
function tell(p: unknown): number { let hits = 0; for (let i = 0; i < 300; i++) if (p === 2.5) hits++; return hits; }
console.log(tell(Meter.prototype));
