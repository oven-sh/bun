// The length read behind a push beside a length from in front: elements below, at and above both, in loops and out of them.
const out = [];
function appended(a) { let s = 0; for (let i = 0, e = a.length; i < e; i++) { const old = a.length; a.push(1, 2); if (a.length > old + 1) s += a[old]; } return s + ":" + a.length; }
function one(a) { let s = 0; for (let i = 0, e = a.length; i < e; i++) { const old = a.length; a.push(i); if (a.length > old) s += a[old]; const n = a.length; if (i < n) s += a[i]; } return s; }
function last(a, v) { a.push(v); const n = a.length; return a[n - 1] === v && a[0]; }
function each(a) { let s = 0; a.push(5); for (let i = 0; i < a.length; i++) s += a[i]; a.push(6); for (let i = a.length - 1; i >= 0; i--) s = s * 2 + a[i]; return s; }
function inner(a) { let s = 0; for (let i = 0; i < 4; i++) { a.push(i); for (let j = 0; j < a.length; j++) s += a[j]; if (a.length > 6) a.length = 2; } return s; }
for (const make of [() => [], () => [1], () => [1, 2, 3], () => [0.5, 1], () => ["a", "b"], () => [, 1], () => new Array(3)]) out.push(appended(make()), one(make()), last(make(), 7), last(make(), "z"), each(make()), inner(make()));
for (let k = 0; k < 20; k++) out.push(one([k, 1]), last([], k));
console.log(out.join(" "));
