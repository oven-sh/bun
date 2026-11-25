// A literal that a loop fills: its length grows behind the question which kind of storage it has.
// Under: --aot-testing=CheckEffectsAtRunTime: an iteration that runs again has done nothing that is seen
function lengths(x) { const a = []; let s = 0; for (let i = 0; i < x.length; i++) { s += a.length; a[i] = x[i]; } return [s, a]; }
function full(x) { const a = []; let s = ""; for (let i = 0; i < x.length; i++) { s += a.length === i ? "." : "!"; a[i] = x[i]; } return [s, a]; }
function pushed(x) { const a = []; for (let i = 0; i < x.length; i++) a.push(x[i]); return [a]; }
function pushedLength(x) { const a = []; let s = 0; for (let i = 0; i < x.length; i++) { s += a.length; a.push(x[i]); } return [s, a]; }
function zero(x) { const a = [0]; let s = 0; for (let i = 0; i < x.length; i++) { s += a.length; a[i + 1] = x[i]; } return [s, a]; }
function last(x) { const a = []; let s = 0; for (let i = 0; i < x.length; i++) { s += a[a.length - 1] === undefined ? 1 : 0; a[i] = x[i]; } return [s, a]; }
const bodies = { lengths, full, pushed, pushedLength, zero, last };
for (const x of [[1, 2, 3, 4], [1, 2, "a", 4], [1, 2, 3, "a"], ["a", 1, 2], [1, 2, 0.5, 4], [1, 2, undefined, 3], [1, 2, {}, 3], [0.5, 1, "t", 2]]) for (const b in bodies) console.log(b, JSON.stringify(bodies[b](x)), JSON.stringify(x));
