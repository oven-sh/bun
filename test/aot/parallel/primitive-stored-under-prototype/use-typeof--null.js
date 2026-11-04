function Meter() { this.n = 1; }
Meter.prototype = null;
const k = JSON.parse('"n"');
function use(p, q) { let out; for (let i = 0; i < 300; i++) { try { out = typeof p; } catch (e) { out = e.constructor.name; } } return out; }
console.log(String(use(Meter.prototype, Meter.prototype)));
