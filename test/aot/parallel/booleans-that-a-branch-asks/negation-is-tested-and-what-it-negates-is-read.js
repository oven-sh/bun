// a negation is tested, and both the negation and what it negates are read on each side
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(a, b) { const less = a < b; const no = !less; if (no) return [less, no, "no"]; return [less, no, "yes"]; }
function other(a, b) { const less = a < b; if (!less) return [less, "no"]; return [less, "yes"]; }
function twice(a, b) { const less = a < b; if (!!less) return [less, "yes"]; return [less, "no"]; }
const numbers = [0, -0, 1, 2.5, NaN, Infinity, -Infinity, "2", "", null, undefined, true];
console.log(numbers.map(a => numbers.map(b => JSON.stringify(subject(a, b))).join("")).join("\n"));
console.log(numbers.map(a => numbers.map(b => JSON.stringify(other(a, b)) + JSON.stringify(twice(a, b))).join("")).join("\n"));
