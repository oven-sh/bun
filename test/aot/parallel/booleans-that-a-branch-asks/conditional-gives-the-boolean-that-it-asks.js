// c ? c : x and c ? x : c
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function first(a, b, x) { const c = a === b; return c ? c : x; }
function second(a, b, x) { const c = a === b; return c ? x : c; }
function anything(c, x) { return [c ? c : x, c ? x : c]; }
console.log(values.map(v => show(first(v, 1, "x")) + " " + show(second(v, 1, "x"))).join(" "));
console.log(values.map(v => show(anything(v, "x")[0]) + " " + show(anything(v, "x")[1])).join(" "));
