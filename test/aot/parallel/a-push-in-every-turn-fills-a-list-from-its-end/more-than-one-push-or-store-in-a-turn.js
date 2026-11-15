function twiceOntoOne(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { a.push(i & 3); a.push(i & 1); } return a.join(""); }
function ontoTwo(n) { const m = n | 0, a = [], b = []; for (let i = 0; i < m; i++) { a.push(i & 3); b.push(i * 0.5); } return a.join("") + "|" + b.length + ":" + b[m - 1]; }
function pushedAndStored(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { a.push(i & 3); a[i] = 7; } return a.join(""); }
function storedAndPushed(n) { const m = n | 0, a = [], b = []; for (let i = 0; i < m; i++) { a[i] = i & 3; b.push(i & 1); } return a.join("") + "|" + b.join(""); }
function twoAtOnce(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a.push(i & 3, i & 1); return a.join(""); }
function theAnswerIsRead(n) { const m = n | 0, a = []; let s = 0; for (let i = 0; i < m; i++) s += a.push(i & 3); return s + ":" + a.join(""); }
function notInEveryTurn(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) { if (i & 1) a.push(i & 3); } return a.join(""); }
const said = [];
for (const n of [0, 1, 2, 5, 6, 9, 17, 40]) said.push(twiceOntoOne(n), ontoTwo(n), pushedAndStored(n), storedAndPushed(n), twoAtOnce(n), theAnswerIsRead(n), notInEveryTurn(n));
console.log(said.join(" "));
