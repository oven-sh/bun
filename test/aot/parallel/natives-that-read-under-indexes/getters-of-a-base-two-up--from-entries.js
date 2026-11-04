const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
class Base { get 0() { return first(this.k); } get 1() { return second(this.v); } }
class Middle extends Base { other() { return 1; } }
class Pair extends Middle { constructor(k, v) { super(); this.k = k; this.v = v; } }
const make = (k, v) => new Pair(k, v);
const list = []; for (let i = 0; i < 40; i++) list.push(make(i, i * 2));
try {
const record = Object.fromEntries(list);
let total = 0; for (const key in record) total += typeof record[key] === "function" ? 1 : key.length + String(record[key]).length;
console.log(Object.keys(record).length, typeof record.K7 === "function" ? "function" : record.K7, total);
} catch (error) { console.log(error.constructor.name); }
