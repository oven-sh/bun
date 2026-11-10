function f(data, t) { let s = data.start; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
const all = ['{"start":-0,"rows":[-0,-0]}', '{"start":0,"rows":[2147483647,1]}', '{"start":0,"rows":[-2147483648,-1]}', '{"start":0,"rows":[9007199254740991,2]}', '{"start":0,"rows":[1e308,1e308]}', '{"start":0,"rows":[5e-324,5e-324]}', '{"start":"","rows":[1,2]}', '{"start":null,"rows":[1,2]}', '{"start":0,"rows":[4294967296,0.5]}'];
for (let r = 0; r < rounds; r++) for (const text of all) { const said = f(JSON.parse(text), r); console.log(String(said), Object.is(said, -0)); }
