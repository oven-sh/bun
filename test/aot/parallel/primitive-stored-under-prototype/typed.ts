function Meter(this: { n: number }) { this.n = 1; }
(Meter as any).prototype = null;
function tell(p: object | null): number { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(Meter.prototype), typeof Meter.prototype);
