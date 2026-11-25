function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
let calls = 0; const lists = [[3, 1, 4, 1, 5], [10, 20, 30], [100, 200, 300, 400, 500, 600, 700]];
const data = { get rows() { return lists[calls++ % 3]; } };
for (let r = 0; r < rounds; r++) console.log(f(data, r), calls);
