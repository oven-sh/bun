function g(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) { s = s + data.rows[i]; if (i == 1) data.rows.push(40, 50); if (i == 5) data.rows.length = 7; } return s; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const data = JSON.parse('{"rows":[3,1,4,1,5,9,2,6]}'); console.log(g(data, r), data.rows.join()); }
