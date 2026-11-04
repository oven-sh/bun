function Meter() { this.n = 1; }
Meter.prototype = { show() { return this.n + 6; } };
const early = new Meter();
Meter.prototype = null;
const late = new Meter();
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (p === null) hits++; return hits; }
function use(m) { let out = ""; for (let i = 0; i < 300; i++) { try { out = String(m.show()); } catch (e) { out = e.constructor.name; } } return out; }
console.log(tell(Meter.prototype), use(early), use(late));
