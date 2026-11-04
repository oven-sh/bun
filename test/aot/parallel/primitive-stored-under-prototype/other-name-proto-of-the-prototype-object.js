function Meter() { this.n = 1; }
Meter.prototype.__proto__ = null;
function use(p, m) { let out = ""; for (let i = 0; i < 300; i++) out = typeof p.__proto__ + ":" + typeof m.toString + ":" + (Object.getPrototypeOf(p) === null); return out; }
console.log(use(Meter.prototype, new Meter()));
