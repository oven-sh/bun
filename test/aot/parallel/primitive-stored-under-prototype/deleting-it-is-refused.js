function Meter() { this.n = 1; }
let how; try { how = String(delete Meter.prototype); } catch (e) { how = e.constructor.name; }
function tell(p) { let out = ""; for (let i = 0; i < 300; i++) out = typeof p; return out; }
console.log(how, tell(Meter.prototype), Reflect.deleteProperty(Meter, "prototype"));
