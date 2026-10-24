// A field goes away again, or is never a plain one.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
class A { ga = { qf: 1 }; gb = { qf: 2 }; }
const a = new A(); delete a.ga;
console.log(attempt(() => a.ga.qf), a.gb.qf, Object.keys(a).join());
const a2 = new A(); Reflect.deleteProperty(a2, "gb");
console.log(attempt(() => a2.gb.qf));
const a3 = new A(); Object.defineProperty(a3, "ga", { get() { return undefined; } });
console.log(attempt(() => a3.ga.qf));
const a4 = new A(); const key = JSON.parse('"ga"'); delete a4[key];
console.log(attempt(() => a4.ga.qf));
const a5 = new A(); a5.ga = undefined;
console.log(attempt(() => a5.ga.qf));
const a6 = new A(); Object.assign(a6, JSON.parse('{"ga":null}'));
console.log(attempt(() => a6.ga.qf));
const a7 = new A(); for (const k in a7) delete a7[k];
console.log(attempt(() => a7.gb.qf), Object.keys(a7).length);
const a8 = new A(); Object.setPrototypeOf(a8, null); console.log(a8.ga.qf);
function readAll(o) { return attempt(() => o.ga.qf + o.gb.qf); }
console.log([a, a2, a3, a4, a5, a6, a7, a8, new A()].map(readAll).join());
