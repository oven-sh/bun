function great(n) { const m = n | 0, a = []; for (let i = 0; i < m; i++) a[i] = i & 255; let s = 0; for (let i = 0; i < a.length; i += 997) s += a[i]; return a.length + ":" + s; }
function rows(n, w) { const m = n | 0, k = w | 0, kept = []; for (let r = 0; r < m; r++) { const row = []; for (let i = 0; i < k; i++) row[i] = i & 15; kept.push(row); } let s = 0; for (const row of kept) s += row.length + row[row.length - 1]; return s; }
console.log(great(300000), great(70000), rows(2000, 33), rows(500, 130), rows(3, 1));
