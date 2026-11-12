function g(data, other, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) { s = s + data.rows[i]; if (i + 1 < other.length) other[i + 1] = i & 1 ? "x" : 0.5; } return s; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const data = JSON.parse('{"rows":[3,1,4,1,5,9,2,6]}'); console.log(String(g(data, data.rows, r)), data.rows.join()); const apart = JSON.parse('{"rows":[3,1,4,1,5,9,2,6]}'); console.log(String(g(apart, [0, 0, 0], r)), apart.rows.join()); }
