// a Boolean comes to one test from several sides: a constant, a comparison, a parameter
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(which, a, b, given) { let c; if (which === 0) c = true; else if (which === 1) c = false; else if (which === 2) c = a === b; else if (which === 3) c = a < b; else c = given; if (c) return [c, "yes"]; return [c, "no"]; }
const out = [];
for (let which = 0; which < 5; which++) for (const v of values) { try { out.push(show(subject(which, v, 1, v)[0]) + subject(which, v, 1, v)[1]); } catch (e) { out.push(e.constructor.name); } }
console.log(out.join(" "));
