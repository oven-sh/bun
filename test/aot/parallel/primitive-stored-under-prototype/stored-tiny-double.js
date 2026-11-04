function Meter() { this.n = 1; }
Meter.prototype = 5e-324;
function tell(p) { let out = ""; for (let i = 0; i < 300; i++) out = [typeof p, p === null, p === undefined, p == null, !p, typeof p === "object", p instanceof Object].join(); return out; }
function read(p) { let out = ""; for (let i = 0; i < 300; i++) { try { out = String(p.n) + ":" + String(p?.n); } catch (e) { out = e.constructor.name; } } return out; }
function keys(p) { try { return Object.keys(p).length + ":" + String(p); } catch (e) { return e.constructor.name; } }
console.log(tell(Meter.prototype)); console.log(read(Meter.prototype)); console.log(keys(Meter.prototype));
console.log(new Meter().n, Object.getPrototypeOf(new Meter()) === Object.prototype, new Meter() instanceof Object);
