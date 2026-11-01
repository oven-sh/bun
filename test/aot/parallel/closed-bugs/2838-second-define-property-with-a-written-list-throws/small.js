function F() { this.a = 1; }
const o = new F();
function cb(v) { Object.defineProperty(o, "length", { value: [1, "e"], writable: false }); return v; }
try { cb(1); cb(2); console.log("no throw"); } catch (e) { console.log("threw", e.name); }
