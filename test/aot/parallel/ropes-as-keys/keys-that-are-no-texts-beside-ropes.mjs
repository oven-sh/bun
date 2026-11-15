const input = JSON.parse('{"a":"alpha","b":"beta","c":"gamma","wide":"\\u03b1\\u03b2","narrowInWide":"xy\\u03b1","long":"0123456789abcdef"}');
const { a, b, c, wide, narrowInWide, long } = input;
const said = [];
function times(text, n) { let made = ""; for (let k = 0; k < n; k++) made += text; return made; }
const map = new Map([["12", "text"], [12, "number"], ["null", "text null"], [null, "null"], ["1.5", "text fraction"], [1.5, "fraction"]]);
const one = String(input.a.length - 4), two = String(input.b.length - 2);
for (let turn = 0; turn < 300; turn++) { said.length = 0; said.push(map.get(one + two), map.get(12), map.get("nu" + "ll".slice(turn & 0)), map.get(null), map.get(one + "." + "5".slice(turn & 0)), map.get(1.5)); }
console.log(said.join("\n"));
