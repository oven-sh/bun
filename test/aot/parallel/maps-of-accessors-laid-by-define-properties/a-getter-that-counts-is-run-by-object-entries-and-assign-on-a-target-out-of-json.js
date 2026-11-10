const seed = Number(process.argv[2] ?? 3);
let hits = 0;
const map = { first: { enumerable: true, get() { hits++; return this.a + seed; } } };
const target = JSON.parse('{"a":1}');
Object.defineProperties(target, map);
const entries = Object.entries(target).join(";");
const copy = Object.assign({}, target);
const spread = { ...target };
console.log(entries, copy.first, spread.first, hits);
