// a closure made on one side of the test keeps the Boolean that was tested
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(a, b) { const same = a === b; if (same) return () => same; return () => [same]; }
console.log(values.map(v => show(subject(v, 1)())).join(" "));
function changed(a, b) { let same = a === b; const read = () => same; if (same) { same = "changed"; return [read(), same]; } return [read(), same]; }
console.log(values.map(v => show(changed(v, 1))).join(" "));
