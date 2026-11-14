const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map([["phabeta", 1], ["betaalp", 2], ["lphamm", 3]]);
for (let turn = 0; turn < 300; turn++) { said.length = 0; said.push(map.get(a.substring(2) + b), map.get(b + a.substring(0, 3)), map.get(a.slice(1) + c.slice(2, 4)), map.get(a.substring(3) + b), map.get((a + b).substring(2))); }
console.log(said.join("\n"));
