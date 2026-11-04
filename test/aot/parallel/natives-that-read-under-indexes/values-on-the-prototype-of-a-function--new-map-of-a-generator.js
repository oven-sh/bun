const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
function Pair(k, v) { this.k = k; this.v = v; }
Pair.prototype[0] = first(7); Pair.prototype[1] = second(7);
const make = (k, v) => new Pair(k, v);
const list = []; for (let i = 0; i < 40; i++) list.push(make(i, i * 2));
try {
function* all() { for (const entry of list) yield entry; }
const map = new Map(all());
let total = 0; const seen = [];
for (const [key, value] of map) { total += key.length + value.length; seen.push(typeof key === "function" ? "function" : key, typeof value === "function" ? "function" : value); }
console.log(map.size, map.has("K7"), map.get("K7"), total, seen.slice(0, 6).join());
} catch (error) { console.log(error.constructor.name); }
