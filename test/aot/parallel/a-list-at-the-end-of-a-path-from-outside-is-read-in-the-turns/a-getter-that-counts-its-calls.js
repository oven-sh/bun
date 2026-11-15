function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
let calls = 0; const rows = [3, 1, 4, 1, 5];
const data = { get rows() { calls++; return rows; } };
for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
