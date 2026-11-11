// A member of an object literal under a well-known symbol: a generator method of a literal.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 3
const o = { k: 3, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i; } };
function sum(l: Iterable<number>): number { let s = 0; for (const x of l) s += x; return s; }
console.log(sum(o), [...o].join(), Math.max(...o)); const [a, b] = o; console.log(a, b);
