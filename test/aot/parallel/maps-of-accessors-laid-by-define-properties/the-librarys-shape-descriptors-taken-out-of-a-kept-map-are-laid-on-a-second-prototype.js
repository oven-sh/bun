const seed = Number(process.argv[2] ?? 3);
const accessors = { first: { __proto__: null, get() { return this.n + 1; } }, second: { __proto__: null, get() { return this.n * 2; }, set(v) { this.n = v; } } };
const internals = { kept: undefined, other: 1 };
function Writer(n) { this.n = n; }
Object.defineProperties(Writer.prototype, accessors);
internals.kept = accessors;
function Both(n) { this.n = n; }
const kept = internals.kept;
Object.defineProperties(Both.prototype, { first: kept.first, second: kept.second });
const w = new Writer(seed), b = new Both(seed + 10);
b.second = 40;
console.log(w.first, w.second, b.first, b.second);
