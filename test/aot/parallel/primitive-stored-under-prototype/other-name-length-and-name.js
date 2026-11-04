function Meter(a, b) { this.n = 1; }
Object.defineProperty(Meter, "length", { value: "long" });
Object.defineProperty(Meter, "name", { value: 5 });
function use(f) { let out = ""; for (let i = 0; i < 300; i++) out = typeof f.length + ":" + typeof f.name; return out; }
let how = "stored"; try { Meter.length = 3; } catch (e) { how = e.constructor.name; }
console.log(use(Meter), how);
