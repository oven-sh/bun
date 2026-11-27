function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const data = JSON.parse('{"rows":[3,1,4,1,5,9,2,6]}'); data.rows[2] = { valueOf() { data.rows = [100, 200, 300, 400, 500]; return 7; } }; console.log(f(data, r), data.rows.length); }
