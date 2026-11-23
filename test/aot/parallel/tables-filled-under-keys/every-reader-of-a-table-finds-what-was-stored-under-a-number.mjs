class Item { constructor(v) { this.v = v; } twice() { return this.v * 2; } }
const keys = JSON.parse("[3, 11, 4, 3, 1000000, 0.5, -1]");
const memo = {};
function put(k, v) { memo[+k] = new Item(v); }
function get(k) { const found = memo[+k]; return found ? found.v : -1; }
for (let i = 0; i < keys.length; i++) put(keys[i], i * 10 + 0.5);
const out = [];
for (let i = 0; i < keys.length; i++) out.push(get(keys[i]), get(keys[i] + 1));
out.push(memo[3].twice(), memo["11"].v, memo["0.5"].v, memo[-1].v, "4" in memo, 5 in memo);
out.push(Object.keys(memo).join("|"), Object.values(memo).map(x => x.v).join("|"), Object.entries(memo).map(([k, x]) => k + x.twice()).join("|"));
let seen = ""; for (const k in memo) seen += k + ":" + memo[k].v + ";"; out.push(seen);
out.push(JSON.stringify(memo), JSON.stringify({ ...memo }), JSON.stringify(Object.assign({}, memo)));
for (const x of Object.values(memo)) x.v = "text"; out.push(get(3), typeof get(11));
delete memo[3]; out.push(get(3), Object.keys(memo).length);
console.log(out.join(" "));
