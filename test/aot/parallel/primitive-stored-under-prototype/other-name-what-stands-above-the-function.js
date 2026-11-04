function Meter() { this.n = 1; }
Meter.__proto__ = null;
function use(f) { let out = ""; for (let i = 0; i < 300; i++) out = typeof f.call + ":" + typeof f.__proto__ + ":" + (Object.getPrototypeOf(f) === null); return out; }
console.log(use(Meter));
