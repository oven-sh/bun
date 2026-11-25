class Item { constructor(v) { this.v = v; } }
const keys = JSON.parse("[3, 11, 4, 1000000, 0.5, -1]");
const memo = {};
function put(k, v) { memo[+k] = new Item(v); }
function get(k) { const found = memo[+k]; return found ? found.v : -1; }
function sum() { let s = 0; for (let i = 0; i < keys.length; i++) { const v = get(keys[i]); s += typeof v === "number" ? v : 1000; } return s; }
for (let i = 0; i < keys.length; i++) put(keys[i], i * 10 + 1);
const before = sum();
memo["11"].v = "text"; memo[4].v = "text";
console.log(before, sum(), typeof get(3), typeof get(11), typeof get(0.5), get(77));
