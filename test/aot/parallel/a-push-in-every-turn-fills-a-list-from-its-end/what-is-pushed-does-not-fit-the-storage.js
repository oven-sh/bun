function show(a) { let s = a.length + ":"; for (let i = 0; i < a.length; i++) s += (i in a ? Object.is(a[i], -0) ? "-0" : String(a[i]) : "hole") + ","; return s; }
function notANumber(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push((i - 3) / (i - 3) * i); return show(a); }
function belowNothing(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i * -0); return show(a); }
function pastInt32(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i * 1000000000); return show(a); }
function aFractionLate(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i < 6 ? i : i + 0.5); return show(a); }
function aTextLate(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i < 6 ? i : "t"); return show(a); }
function ontoFractionsWritten(n) { const m = n | 0, a = [0.5]; for (let i = 1; i < m; i++) a.push(i & 3); return show(a); }
function ontoATextWritten(n) { const m = n | 0, a = ["t"]; for (let i = 1; i < m; i++) a.push(i & 3); return show(a); }
const said = [];
for (const n of [0, 1, 4, 7, 12]) said.push(notANumber(n), belowNothing(n), pastInt32(n), aFractionLate(n), aTextLate(n), ontoFractionsWritten(n), ontoATextWritten(n));
console.log(said.join(" "));
