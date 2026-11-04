function Meter() { this.n = 1; }
Meter.limit = function () { return 1; };
Meter.limit = null;
function use(f) { let out = ""; for (let i = 0; i < 300; i++) out = String(f.limit === null) + ":" + typeof f.limit; return out; }
console.log(use(Meter));
