const cache = new Map();
function get(i) { let o = cache.get(i & 1); for (let k = 0; k < 1 && !o; k++) { o = { lid: i, uses: 0 }; cache.set(i & 1, o); } return o; }
function use(i) { const o = get(i); o.uses++; return o.lid; }
let sum = 0; for (let i = 0; i < 6; i++) sum += use(i);
console.log(sum, [...cache.values()].map(o => o.lid + ":" + o.uses).join());
