const seed = Number(process.argv[2] ?? 3);
const map = { first: { get() { return this.n + 1; } }, n: { value: seed, writable: true } };
const made = Object.create({ above: 1 }, map);
const again = Object.create(null, map);
again.n = "text";
console.log(made.first, again.first, made.above, Object.keys(made).length);
