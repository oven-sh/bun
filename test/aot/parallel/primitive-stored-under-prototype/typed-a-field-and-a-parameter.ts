interface Counted { n: number; }
function Meter(this: Counted) { this.n = 1; }
(Meter as any).prototype = 7;
class Holder { held: unknown = Meter.prototype; }
function tell(p: unknown): number { let hits = 0; for (let i = 0; i < 300; i++) if (typeof p === "number") hits++; return hits; }
function read(p: any): string { let out = ""; for (let i = 0; i < 300; i++) out = String(p.n) + ":" + String(p?.n); return out; }
console.log(tell(Meter.prototype), tell(new Holder().held), read(Meter.prototype));
