const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map(); for (const n of [2047, 2048, 2049, 4096]) map.set(times("x", n), n);
for (let turn = 0; turn < 60; turn++) { said.length = 0; for (const n of [2046, 2047, 2048, 2049, 2050, 4096, 4097]) { const half = n >> 1; const key = times("x", half) + times("x", n - half); said.push(n + ":" + map.get(key) + ":" + map.has(key)); } }
console.log(said.join("\n"));
