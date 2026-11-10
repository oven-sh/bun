function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const seen = [];
const data = new Proxy({ rows: [3, 1, 4, 1, 5] }, { get(target, key) { seen.push(String(key)); return target[key]; } });
for (let r = 0; r < rounds; r++) console.log(f(data, r), seen.length);
