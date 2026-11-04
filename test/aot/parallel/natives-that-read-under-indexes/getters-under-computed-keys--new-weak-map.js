const cells = []; for (let i = 0; i < 64; i++) cells.push({ id: "C" + i });
const first = (k) => cells[k];
const second = (v) => "V" + v + "!";
const zero = 0, one = 1;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get [zero]() { return first(this.k); } get [one]() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const list = []; for (let i = 0; i < 40; i++) list.push(make(i, i * 2));
try {
const map = new WeakMap(list);
let total = 0; for (let i = 0; i < 40; i++) { const got = map.get(cells[i]); total += got === undefined ? -1000 : got.length; }
console.log(map.has(cells[7]), map.get(cells[7]), total);
} catch (error) { console.log(error.constructor.name); }
