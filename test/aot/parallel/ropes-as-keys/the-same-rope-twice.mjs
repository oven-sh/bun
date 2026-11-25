const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map([["alphabeta", 1]]); const other = new Map([["alphabeta", 2]]); const empty = new Map();
for (let turn = 0; turn < 300; turn++) { said.length = 0; const key = a + b; said.push(map.get(key), map.get(key), other.get(key), empty.get(key), map.has(key), key === "alphabeta", key.length); const missing = b + a; said.push(map.get(missing), map.get(missing), other.has(missing), missing, missing.length); }
console.log(said.join("\n"));
