// x || y hands on x itself where x is truthy, and x may be anything
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(x, y) { return x || y; }
console.log(values.map(v => show(subject(v, "other"))).join(" "));
console.log(values.map(v => show(subject(false, v))).join(" "));
