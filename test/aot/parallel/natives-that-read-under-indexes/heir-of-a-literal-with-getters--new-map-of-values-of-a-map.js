const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const above = { get 0() { return first(this.k); }, get 1() { return second(this.v); } };
const make = (k, v) => { const pair = Object.create(above); pair.k = k; pair.v = v; return pair; };
const list = []; for (let i = 0; i < 40; i++) list.push(make(i, i * 2));
try {
const held = new Map(); list.forEach((entry, i) => held.set(i, entry));
const map = new Map(held.values());
let total = 0; const seen = [];
for (const [key, value] of map) { total += key.length + value.length; seen.push(typeof key === "function" ? "function" : key, typeof value === "function" ? "function" : value); }
console.log(map.size, map.has("K7"), map.get("K7"), total, seen.slice(0, 6).join());
} catch (error) { console.log(error.constructor.name); }
