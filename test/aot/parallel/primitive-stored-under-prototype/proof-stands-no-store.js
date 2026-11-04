function Meter() { this.n = 1; }
Meter.prototype.show = function () { return this.n + 6; };
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (typeof p === "object" && p !== null) hits++; return hits; }
function use(m) { let sum = 0; for (let i = 0; i < 300; i++) sum += m.show() + m.n; return sum; }
console.log(tell(Meter.prototype), use(new Meter()));
