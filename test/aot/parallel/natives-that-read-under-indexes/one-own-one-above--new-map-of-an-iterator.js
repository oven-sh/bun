const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
class Pair { constructor(k, v) { this[0] = first(k); this.v = v; } get 1() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const list = []; for (let i = 0; i < 40; i++) list.push(make(i, i * 2));
try {
const map = new Map(list.values());
let total = 0; const seen = [];
for (const [key, value] of map) { total += key.length + value.length; seen.push(typeof key === "function" ? "function" : key, typeof value === "function" ? "function" : value); }
console.log(map.size, map.has("K7"), map.get("K7"), total, seen.slice(0, 6).join());
} catch (error) { console.log(error.constructor.name); }
