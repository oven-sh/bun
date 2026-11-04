// ||=, &&= and ??= on a Boolean and on anything
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function or(a, b, y) { let c = a === b; c ||= y; return c; }
function and(a, b, y) { let c = a === b; c &&= y; return c; }
function nullish(a, b, y) { let c = a === b; c ??= y; return c; }
function orAnything(c, y) { c ||= y; return c; }
function andAnything(c, y) { c &&= y; return c; }
console.log(values.map(v => [or(v, 1, "y"), and(v, 1, "y"), nullish(v, 1, "y"), orAnything(v, "y"), andAnything(v, "y")].map(show).join(",")).join(" "));
