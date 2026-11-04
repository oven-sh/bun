// one Boolean is tested twice, with something between, and read behind each test
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
let noise = 0;
function subject(a, b) { const same = a === b; let out = []; if (same) out.push(same); noise++; if (same) out.push(same, "again"); else out.push(same, "never"); if (!same) out.push(same); return out; }
console.log(values.map(v => JSON.stringify(subject(v, 1))).join(" "), noise);
