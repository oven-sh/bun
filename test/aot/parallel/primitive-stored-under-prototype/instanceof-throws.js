function Meter() { this.n = 1; }
const made = new Meter();
Meter.prototype = null;
function ask(x) { try { return String(x instanceof Meter); } catch (e) { return e.constructor.name; } }
let out = ""; for (let i = 0; i < 300; i++) out = ask(made) + ask({}) + ask(5);
console.log(out);
