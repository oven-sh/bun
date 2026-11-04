function Meter() { this.n = 1; }
Meter.prototype.show = function () { return 7; };
Meter.prototype = null;
function use(m) { let out = ""; for (let i = 0; i < 300; i++) out = typeof m.show; return out; }
console.log(use(new Meter()));
