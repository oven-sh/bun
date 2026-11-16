const seed = Number(process.argv[2] ?? 3);
let hits = 0, kept = 0;
const accessors = { first: { get() { hits++; return this.n + 1; } }, enumerable: { get() { return 2; }, set(v) { kept = v; } } };
const internals = { kept: undefined, other: 1 };
function Writer(n) { this.n = n; }
const box = JSON.parse("{}"); box.w = Writer;
Object.defineProperties(Writer.prototype, accessors);
internals.kept = accessors;
const w = new Writer(seed);
console.log(w.first, hits, typeof kept);
