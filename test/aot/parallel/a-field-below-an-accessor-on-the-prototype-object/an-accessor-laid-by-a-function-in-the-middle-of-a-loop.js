function P(n) { this.n = n; }
function lay() { Object.defineProperty(P.prototype, "n", { set(v) { this.m = v; }, get() { return this.m; }, configurable: true }); }
let t = 0; for (let i = 0; i < 6; i++) { if (i === 3) lay(); const p = new P(i); t += p.n; t += "m" in p ? 100 : 0; } console.log(t);
