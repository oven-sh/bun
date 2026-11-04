// the Boolean that was tested is stored into a field, an element and a variable of the module on each side
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
let kept; const list = []; const object = {};
function subject(a, b) { const same = a === b; if (same) { kept = same; list.push(same); object.last = same; } else { kept = same; list.push(same); object.last = same; } return show(kept) + show(object.last); }
console.log(values.map(v => subject(v, 1)).join(" "), JSON.stringify(list));
