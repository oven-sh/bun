// switch (true) over comparisons
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(n) { switch (true) { case n === 1: return "one"; case n > 1: return "more"; case n < 1: return "less"; default: return "none"; } }
console.log(values.map(v => { try { return subject(v); } catch (e) { return e.constructor.name; } }).join(" "));
function onTheAnswer(a, b) { const same = a === b; switch (same) { case true: return [same, 1]; case false: return [same, 0]; } }
console.log(values.map(v => JSON.stringify(onTheAnswer(v, 1))).join(" "));
