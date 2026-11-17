class Item { constructor(v) { this.v = v; } }
const keys = JSON.parse("[0.5, -1, 1e21, 7]");
const memo = {};
function put(k, v) { memo[+k] = new Item(v); }
function get(k) { const found = memo[+k]; return found ? found.v : -1; }
for (let i = 0; i < keys.length; i++) put(keys[i], i + 1);
put(0 / 0, 50); put(1 / 0, 60);
const before = [get(0.5), get(-1), get(1e21), get(7), get(NaN), get(Infinity)].join();
memo["0.5"].v = "a"; memo["-1"].v = "b"; memo["1e+21"].v = "c"; memo.NaN.v = "d"; memo.Infinity.v = "e";
console.log(before, get(keys[0]), get(keys[1]), get(keys[2]), get(keys[3]), get(0 / 0), get(1 / 0), Object.keys(memo).join());
