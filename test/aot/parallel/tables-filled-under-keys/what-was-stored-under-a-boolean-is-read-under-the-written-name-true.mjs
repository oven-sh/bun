class Item { constructor(v) { this.v = v; } }
const flags = JSON.parse("[1, 0, 1]");
const memo = {};
function put(k, v) { memo[!!k] = new Item(v); }
function get(k) { const found = memo[!!k]; return found ? found.v : -1; }
put(flags[0], 5); put(flags[1], 6);
const before = get(flags[2]) + get(flags[1]);
memo.true.v = "text";
console.log(before, get(flags[0]), typeof get(flags[2]), get(flags[1]), typeof memo.false.v, Object.keys(memo).join());
