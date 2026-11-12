const seed = Number(process.argv[2] ?? 3);
const name = "k" + seed;
const map = { [name]: { get() { return this.n + 1; } }, plain: { get() { return this.n - 1; } } };
function T(n) { this.n = n; }
Object.defineProperties(T.prototype, map);
const t = new T(seed);
console.log(t[name], t.plain, t.k3, Object.getOwnPropertyNames(T.prototype).join());
