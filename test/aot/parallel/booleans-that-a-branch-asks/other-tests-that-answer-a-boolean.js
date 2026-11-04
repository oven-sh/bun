// in, instanceof, typeof, == null, Array.isArray, Object.is: each answer is tested and read
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
class C {}
const tests = [
  (v) => { const t = typeof v === "object" && v !== null && "length" in v; if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = v instanceof Array; if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = typeof v === "number"; if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = v == null; if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = Array.isArray(v); if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = Object.is(v, -0); if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = Boolean(v); if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = v != 1; if (t) return [t, 1]; return [t, 0]; },
  (v) => { const t = v !== v; if (t) return [t, 1]; return [t, 0]; },
];
for (const test of tests) console.log(values.map(v => { try { return JSON.stringify(test(v)); } catch (e) { return e.constructor.name; } }).join(""));
