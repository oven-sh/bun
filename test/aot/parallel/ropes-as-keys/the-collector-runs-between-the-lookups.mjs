const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map(); for (let k = 0; k < 200; k++) map.set("key-" + k + "-" + long, k);
let total = 0;
for (let turn = 0; turn < 4000; turn++) { const key = "key-" + (turn % 250) + "-" + long; const found = map.get(key); total += found === undefined ? 1000 : found; if ((turn & 1023) === 0) Bun.gc(true); total += key.length; }
said.push(total);
console.log(said.join("\n"));
