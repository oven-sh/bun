function show(a) { let s = 0; for (let i = 0; i < a.length; i++) { if (!(i in a)) return a.length + ":hole at " + i; s += a[i] * (i + 1); } return a.length + ":" + s + (a[a.length] === undefined && !(a.length in a) ? "" : ":something behind the end"); }
function below(n) { const m = n | 0, a = []; for (let i = 0; (a[i] = i & 7, i < m); i++); return a; }
function upTo(n) { const m = n | 0, a = []; for (let i = 0; (a[i] = i * 0.5, i <= m); i++); return a; }
function pushed(n) { const m = n | 0, a = []; for (let i = 0; (a.push(i & 7), i < m); i++); return a; }
function withABody(n) { const m = n | 0, a = [], b = []; for (let i = 0; (a[i] = i & 7, i < m); i++) b[i] = i & 3; return a.concat(b); }
const all = [below, upTo, pushed, withABody];
const kept = [], said = []; for (let n = -1; n <= 41; n++) for (const f of all) { const a = f(n); kept.push(a); said.push(show(a)); } let again = 0; for (const a of kept) again += a.length; console.log(said.join(" "), again);
