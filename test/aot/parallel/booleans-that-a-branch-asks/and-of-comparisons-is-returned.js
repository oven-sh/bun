// a row of comparisons joined by && is returned: a Boolean, whichever of them answers
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(n) { return n > 0 && n < 3 && n !== 2; }
console.log(values.map(v => { try { return show(subject(v)); } catch (e) { return e.constructor.name; } }).join(" "));
let hits = 0; for (let i = -300; i < 300; i++) hits += subject(i / 2) ? 1 : 0;
console.log(hits);
