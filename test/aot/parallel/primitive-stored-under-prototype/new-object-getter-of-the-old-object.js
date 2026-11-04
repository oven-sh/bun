function Meter() { this.n = 1; }
Object.defineProperty(Meter.prototype, "twice", { get() { return this.n * 2; } });
Meter.prototype = undefined;
function use(m) { let out = ""; for (let i = 0; i < 300; i++) out = String(m.twice); return out; }
console.log(use(new Meter()));
