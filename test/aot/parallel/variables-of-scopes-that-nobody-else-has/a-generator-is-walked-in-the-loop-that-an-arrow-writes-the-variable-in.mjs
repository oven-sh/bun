function* upTo(n) { for (let i = 0; i < n; i++) yield i; }
function* pairs(n) { for (let i = 0; i < n; i++) { yield i; yield -1; } }
function total(n) { let sum = 0; const add = x => { sum += x; }; for (const v of upTo(n)) add(v); return sum; }
function both(n) { let sum = 0, seen = 0; const add = x => { sum += x; seen++; }; for (const v of pairs(n)) { if (v < 0) continue; add(v); if (seen > 40) break; } return sum + "|" + seen; }
function nested(n) { let sum = 0; for (const a of upTo(n)) { [a, a + 1].forEach(x => { sum += x; }); for (const b of upTo(2)) sum += b; } return sum; }
let all = 0; for (let t = 0; t < 300; t++) all += total(t & 15);
console.log(all, total(0), both(5), both(100), nested(6), nested(0));
