const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map([["xyalpha", 1]]);
for (let turn = 0; turn < 300; turn++) { said.length = 0; const key = narrowInWide.substring(0, 2) + a; said.push(map.get(key), key.length, key + wide, (key + b).toUpperCase(), key.indexOf("a"), JSON.stringify(key), [...key].length, key.padEnd(9, wide), encodeURIComponent(key + wide), new TextEncoder().encode(key).length, Buffer.from(key + wide).length); }
console.log(said.join("\n"));
