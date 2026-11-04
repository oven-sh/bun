interface Shown { n: number; show(): number; }
function Meter(this: Shown) { this.n = 1; }
Meter.prototype.show = function (this: Shown): number { return this.n + 6; };
(Meter as any).prototype = null;
function use(m: Shown): string { let out = ""; for (let i = 0; i < 300; i++) { try { out = String(m.show()); } catch (e: any) { out = e.constructor.name; } } return out; }
console.log(use(new (Meter as any)()));
