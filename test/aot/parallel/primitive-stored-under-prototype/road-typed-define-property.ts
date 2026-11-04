interface Counted { n: number; }
function Meter(this: Counted) { this.n = 1; }
Object.defineProperty(Meter, "prototype", { value: 7 });
function tell(p: unknown): number { let hits = 0; for (let i = 0; i < 300; i++) if (typeof p === "number") hits++; return hits; }
console.log(tell(Meter.prototype));
