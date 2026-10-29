// Module suspended at await leaves a const in its dead zone.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); return { x: 0 }; }
let hook;
let wake;
Promise.resolve().then(() => { console.log(attempt(() => later.x)); wake(); });
await new Promise(r => { wake = r; });
const later = { x: 1 };
console.log(later.x);
