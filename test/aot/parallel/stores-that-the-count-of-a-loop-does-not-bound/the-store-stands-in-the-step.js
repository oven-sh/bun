function show(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return a.length + ":hole at " + i; s += a[i] * (i + 1); } return a.length + ":" + s + (a[a.length] === undefined && !(a.length in a) ? "" : ":something behind the end"); }
function behindTheStep(n) { const m = n | 0, a = [0]; for (let i = 0; i < m; i++, a[i] = i & 7); return a; }
function inFrontOfTheStep(n) { const m = n | 0, a = []; for (let i = 0; i < m; a[i] = i & 7, i++); return a; }
function pushedInTheStep(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++, a.push(i & 7)); return a; }
function pushedInFrontOfTheStep(n) { const m = n | 0, a = []; for (let i = 0; i < m; a.push(i & 7), i++); return a; }
const all = [behindTheStep, inFrontOfTheStep, pushedInTheStep, pushedInFrontOfTheStep];
const kept = [], said = []; for (let n = -1; n <= 41; n++) for (const f of all) { const a = f(n); kept.push(a); said.push(show(a)); } let again = 0; for (const a of kept) again += a.length; console.log(said.join(" "), again);
