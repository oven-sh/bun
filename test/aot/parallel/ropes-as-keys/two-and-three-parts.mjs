const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map([["alphabeta", 1], ["alphabetagamma", 2], ["betaalpha", 3]]);
for (let turn = 0; turn < 300; turn++) { said.length = 0; said.push(map.get(a + b), map.get(a + b + c), map.get(b + a), map.get(c + a), map.has(a + b), map.has(b + c)); }
console.log(said.join("\n"));
