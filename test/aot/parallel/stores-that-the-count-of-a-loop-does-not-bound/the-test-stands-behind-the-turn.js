function show(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return a.length + ":hole at " + i; s += a[i] * (i + 1); } return a.length + ":" + s + (a[a.length] === undefined && !(a.length in a) ? "" : ":something behind the end"); }
function countedBehind(n) { const m = n | 0, a = []; let i = 0; do { a[i] = i & 7; i++; } while (i < m); return a; }
function steppedInTheTest(n) { const m = n | 0, a = []; let i = 0; do { a[i] = i & 7; } while (i++ < m); return a; }
function steppedFirstInTheTest(n) { const m = n | 0, a = []; let i = 0; do { a[i] = i & 7; } while (++i <= m); return a; }
function pushedAndCountedBehind(n) { const m = n | 0, a = []; let i = 0; do { a.push(i & 7); } while (i++ < m); return a; }
const all = [countedBehind, steppedInTheTest, steppedFirstInTheTest, pushedAndCountedBehind];
const kept = [], said = []; for (let n = -1; n <= 41; n++) for (const f of all) { const a = f(n); kept.push(a); said.push(show(a)); } let again = 0; for (const a of kept) again += a.length; console.log(said.join(" "), again);
