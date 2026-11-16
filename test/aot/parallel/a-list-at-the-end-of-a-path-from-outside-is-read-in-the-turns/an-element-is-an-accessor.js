function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
let calls = 0;
for (let r = 0; r < rounds; r++) { const data = JSON.parse('{"rows":[3,1,4,1,5]}'); console.log(f(data, r)); Object.defineProperty(data.rows, 2, { get() { calls++; if (calls == 2) data.rows.length = 3; return 100; } }); console.log(f(data, r), calls, data.rows.length); }
