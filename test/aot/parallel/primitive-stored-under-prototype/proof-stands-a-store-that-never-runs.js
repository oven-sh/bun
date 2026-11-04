function Meter() { this.n = 1; }
function fail() { throw new RangeError("no"); }
let how = "stored"; try { Meter.prototype = fail(); } catch (e) { how = e.constructor.name; }
function tell(p) { let hits = 0; for (let i = 0; i < 300; i++) if (typeof p === "object" && p !== null) hits++; return hits; }
console.log(how, tell(Meter.prototype), new Meter().n);
