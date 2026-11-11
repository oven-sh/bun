function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const above = { rows: [3, 1, 4, 1, 5] }; const data = Object.create(above);
for (let r = 0; r < rounds; r++) { console.log(f(data, r)); if (r == 1) above.rows = [10, 20]; if (r == 2) data.rows = [7]; }
console.log(f(data, 0));
