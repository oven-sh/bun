function first() { return "first ran"; }
const shared = { get() { return this; } };
Object.defineProperties(first, { limit: { enumerable: true, ...shared } });
const same = first.limit;
console.log(same());
