function Meter() { this.n = 1; }
const m = new Meter(); m.__proto__ = 7; const k = new Meter(); k.__proto__ = null;
function use(a, b) { let out = ""; for (let i = 0; i < 300; i++) out = (a.__proto__ === Meter.prototype) + ":" + typeof b.__proto__ + ":" + (Object.getPrototypeOf(b) === null); return out; }
console.log(use(m, k));
