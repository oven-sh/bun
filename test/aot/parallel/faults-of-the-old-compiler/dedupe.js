const rows = [[2.5, 6.5, 2.5], [6.5, 2.5, 6.5], [2.5, 2.5, 6.5]];
function dedupeAll(rs) { return rs.map(r => [...new Set(r)]); }
const a = dedupeAll(rows), b = dedupeAll(rows);
console.log(a[0][1] === 6.5, a[1][1] === 2.5, b[2][1] === 6.5, a[0].length);
