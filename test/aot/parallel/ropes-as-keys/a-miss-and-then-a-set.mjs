const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
for (let turn = 0; turn < 300; turn++) { said.length = 0; const map = new Map(); const key = a + b + turn; said.push(map.get(key), map.has(key)); map.set(key, turn); said.push(map.get(a + b + turn), map.get(key), map.size); map.set(a + b + turn, -turn); said.push(map.size, map.get(key), [...map.keys()][0] === key); map.delete(a + b + turn); said.push(map.size); }
console.log(said.join("\n"));
