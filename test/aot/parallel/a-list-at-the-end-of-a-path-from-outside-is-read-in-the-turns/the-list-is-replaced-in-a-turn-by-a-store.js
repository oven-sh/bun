function g(data, t, other) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) { s = s + data.rows[i]; if (i == 2) other.rows = [100, 200, 300, 400, 500]; } return s; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const data = JSON.parse('{"rows":[3,1,4,1,5,9,2,6]}'); console.log(g(data, r, data), g(JSON.parse('{"rows":[3,1,4,1,5,9,2,6]}'), r, {}), data.rows.length); }
