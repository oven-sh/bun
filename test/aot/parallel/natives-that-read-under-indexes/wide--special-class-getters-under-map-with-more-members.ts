let hits = 0;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get 0() { hits++; return this.k; } get 1() { hits++; return this.v; } get 2() { hits++; return "never"; } swap() { return new Pair(this.v, this.k); } }
let out = "";
const list = [];
for (let i = 0; i < 300; i++) list.push(new Pair("k" + i, i));
const m = new Map(list), back = new Map(list.map((p) => p.swap()));
console.log(m.size, m.get("k7"), back.size, back.get(7), hits);
