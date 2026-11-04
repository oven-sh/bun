// a row of comparisons joined by || is returned: a Boolean, whichever of them answers
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(kind) { return kind === 1 || kind === 2 || kind === 3; }
console.log(values.map(v => show(subject(v))).join(" "));
let hits = 0; for (let i = -300; i < 300; i++) hits += subject(i / 2) ? 1 : 0;
console.log(hits);
