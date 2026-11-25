function byTheHead(a) { const m = a | 0; const small = m + 1 < 9; let total = 0; for (let i = 0; i < m; i++) total += small ? 1 : 2; return total; }
function byATest(a) { const m = a | 0; const small = m + 1 < 9; let total = 0; for (let i = 0; i < 300; i++) { if (m > 6) break; total += small ? 1 : 2; } return total; }
function twoTerms(a) { const m = a | 0, k = (a * 2) | 0; const small = m + k < 20; let total = 0; for (let i = 0; i < m; i++) { if (k > 12) break; total += small ? 1 : 2; } return total; }
const said = [];
for (const m of JSON.parse("[0, 1, 2, 5, 7, 8, 9, 20, -3]")) said.push(byTheHead(m), byATest(m), twoTerms(m));
console.log(said.join());
