class Dial { constructor() { this.n = 1; } }
Dial.prototype.constructor = null;
function use(m) { let out = ""; for (let i = 0; i < 300; i++) out = String(m.constructor === null) + ":" + (m.constructor === Dial); return out; }
console.log(use(new Dial()));
