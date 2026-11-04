interface Counted { n: number; }
function Meter(this: Counted) { this.n = 1; }
function strip(f: { prototype: unknown }, with_: unknown): void { f.prototype = with_; }
strip(Meter, null);
function tell(p: object | null): number { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
console.log(tell(Meter.prototype));
