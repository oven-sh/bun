function show(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return a.length + ":hole at " + i; s += a[i] * (i + 1); } return a.length + ":" + s + (a[a.length] === undefined && !(a.length in a) ? "" : ":something behind the end"); }
function goesRound(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { if (i & 4) continue; a[i] = i & 7; } for (let i = 0; i < a.length; i++) a[i] ??= 9; return a; }
function storesThenGoesRound(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { a[i] = i & 7; if (i & 4) continue; a[i] = 1; } return a; }
function endsEarly(n) { const m = n | 0, a = []; for (let i = 0; i < m && i < 13; i++) a[i] = i & 7; return a; }
function endsLate(n) { const m = n | 0, a = []; for (let i = 0; i < m || i < 13; i++) a[i] = i & 7; return a; }
function leaves(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { a[i] = i & 7; if (i === 21) break; } return a; }
const all = [goesRound, storesThenGoesRound, endsEarly, endsLate, leaves];
const kept = [], said = []; for (let n = -1; n <= 41; n++) for (const f of all) { const a = f(n); kept.push(a); said.push(show(a)); } let again = 0; for (const a of kept) again += a.length; console.log(said.join(" "), again);
