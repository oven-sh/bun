function Meter() { this.n = 1; }
Meter.prototype.show = function () { return 7; };
const Bound = Meter.bind(null);
Meter.prototype = 2.5;
function use(m) { let out = ""; for (let i = 0; i < 300; i++) out = typeof m.show + ":" + m.n; return out; }
console.log(use(new Bound()), typeof Bound.prototype);
