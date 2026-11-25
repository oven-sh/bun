// a closure that is made for one call is handed, in every turn of a loop, to a value from in front of the loop that nobody knows, and one such value keeps it
const kept = [];
function calls(g) { return g(1); }
function keeps(g) { kept.push(g); return g(2); }
function each(f, n) { let s = 0; for (let i = 0; i < n; i++) s = (s + f(v => v + i)) | 0; return s; }
function deed(f, n) { const s = each(f, n); Bun.gc(true); return String(s) + " " + kept.map(g => g(100)).join(); }
console.log(deed(calls, 3));
for (let turn = 0; turn < 300; turn++) each(calls, 2);
console.log(deed(calls, 3));
console.log(deed(keeps, 3));
console.log(deed(calls, 0));
