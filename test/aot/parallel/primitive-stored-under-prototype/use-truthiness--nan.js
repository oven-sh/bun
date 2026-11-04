function Meter() { this.n = 1; }
Meter.prototype = NaN;
const k = JSON.parse('"n"');
function use(p, q) { let out; for (let i = 0; i < 300; i++) { try { out = p ? 't' : 'f'; } catch (e) { out = e.constructor.name; } } return out; }
console.log(String(use(Meter.prototype, Meter.prototype)));
