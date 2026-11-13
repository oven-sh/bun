function first() { return "first ran"; }
const base = { get() { return this; } };
Object.defineProperties(first, { limit: { __proto__: base } });
const same = first.limit;
console.log(same());
