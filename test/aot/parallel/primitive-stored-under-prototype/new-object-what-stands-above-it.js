function Meter() { this.n = 1; }
const first = Meter.prototype;
const early = new Meter();
Meter.prototype = 7;
const late = new Meter();
function use(a, b) { let out = ""; for (let i = 0; i < 300; i++) out = [Object.getPrototypeOf(a) === first, Object.getPrototypeOf(b) === first, Object.getPrototypeOf(b) === Object.prototype, b.constructor === Object, a.constructor === Meter].join(); return out; }
console.log(use(early, late));
