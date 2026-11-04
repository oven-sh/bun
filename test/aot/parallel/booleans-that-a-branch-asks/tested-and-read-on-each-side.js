// a comparison is kept in a constant, tested, and read as a value on each side of the test
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(a, b) { const same = a === b; if (same) return [same, "yes"]; return [same, "no"]; }
let out = [];
for (const a of values) for (const b of values) out.push(show(subject(a, b)[0])[8] + subject(a, b)[1][0]);
console.log(out.join(""));
