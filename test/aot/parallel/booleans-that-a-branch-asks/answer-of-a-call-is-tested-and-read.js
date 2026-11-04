// what a call answers is tested and read: a Boolean from one callee, anything from another
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function isOne(v) { return v === 1; }
function itself(v) { return v; }
function subject(ask, v) { const answer = ask(v); if (answer) return [answer, "yes"]; return [answer, "no"]; }
function direct(v) { const answer = isOne(v); if (answer) return [answer, "yes"]; return [answer, "no"]; }
console.log(values.map(v => show(subject(isOne, v)[0]) + subject(isOne, v)[1]).join(" "));
console.log(values.map(v => show(subject(itself, v)[0]) + subject(itself, v)[1]).join(" "));
console.log(values.map(v => show(direct(v)[0]) + direct(v)[1]).join(" "));
