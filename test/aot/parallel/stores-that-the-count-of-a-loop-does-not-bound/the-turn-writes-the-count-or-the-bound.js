function show(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return a.length + ":hole at " + i; s += a[i] * (i + 1); } return a.length + ":" + s + (a[a.length] === undefined && !(a.length in a) ? "" : ":something behind the end"); }
function stepsTwice(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { a[i] = i & 7; if (i === 5) { i++; a[i] = 3; } } return a; }
function stepsBack(n) { const m = n | 0, a = []; let once = true; for (let i = 0; i < m; i++) { a[i] = i & 7; if (i === 5 && once) { once = false; i -= 2; } } return a; }
function boundGrows(n) { let m = n | 0; const a = []; for (let i = 0; i < m; i++) { a[i] = i & 7; if (i === 3 && m < 30) m += 9; } return a; }
function boundIsTheLength(n) { const m = n | 0, a = [1]; for (let i = 1; i <= a.length && i < m; i++) a[i] = i & 7; return a; }
function storesAhead(n) { const m = n | 0, a = [0]; for (let i = 0; i < m; i++) a[i + 1] = i & 7; return a; }
const all = [stepsTwice, stepsBack, boundGrows, boundIsTheLength, storesAhead];
const kept = [], said = []; for (let n = -1; n <= 41; n++) for (const f of all) { const a = f(n); kept.push(a); said.push(show(a)); } let again = 0; for (const a of kept) again += a.length; console.log(said.join(" "), again);
