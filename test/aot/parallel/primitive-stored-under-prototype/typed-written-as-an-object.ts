interface Counted { n: number; }
function Meter(this: Counted) { this.n = 1; }
(Meter as any).prototype = undefined;
function read(p: Counted): string { let out = ""; for (let i = 0; i < 300; i++) { try { out = String(p.n); } catch (e: any) { out = e.constructor.name; } } return out; }
console.log(read(Meter.prototype));
