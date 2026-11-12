const out = [];
const log = (...values) => out.push(values.map(v => (Array.isArray(v) ? "[" + v + "]" : Object.is(v, -0) ? "-0" : String(v))).join(" "));
const list = JSON.parse('[3,1,4,1,5,9,2,6]'), mixed = JSON.parse('[1,"2",null,4.5,true]');
const names = new Map([["a", 1], ["b", 2], ["c", 3]]), empty = new Map(), marks = new Set([-0, NaN, "x"]);
class Cache { constructor(limit) { this.limit = limit; this.entries = new Map(); this.dropped = []; } put(key, value) { this.entries.delete(key); this.entries.set(key, value); if (this.entries.size > this.limit) { const oldest = this.entries.keys().next().value; this.dropped.push(oldest); this.entries.delete(oldest); } return this.entries.size; } first() { return this.entries.values().next().value; } }
class Own extends Map { keys() { return [42][Symbol.iterator](); } }
const own = new Own([["k", 1]]);
const cache = new Cache(3);
function step(x, i) { return names.keys().next().value + names.values().next().value + x + String(empty.keys().next().value) + marks.values().next().value + own.keys().next().value; }
function pair(x) { const [a, b] = names.keys(); const [c = "none"] = empty.values(); const [d, e, f, g = 7] = marks; return [a, b, c, Object.is(d, -0), e, f, g, x]; }
function spread(x) { return [...names.keys(), ...names.values(), x, ...marks.keys()].length + Math.max(...names.values()); }
function grows(x, i) { names.set("k" + i, x); const first = names.keys().next().value; if (names.size > 4) names.delete(first); return first; }
function run(source) { for (let i = 0; i < source.length; i++) { const x = source[i]; log(step(x, i)); log(pair(x)); log(spread(x)); log(grows(x, i), cache.put(x, i), cache.first()); } }
function direct(source) { let s = ""; for (let i = 0; i < source.length; i++) { const x = source[i]; s += names.keys().next().value + x; const [a] = names.values(); s += a; } return s; }
for (let round = 0; round < 2; round++) { run(list); run(mixed); log(direct(list), direct(mixed), cache.dropped); }
names.keys = () => ["mine"][Symbol.iterator]();
run(list); log(direct(mixed));
console.log(out.join("\n"));
