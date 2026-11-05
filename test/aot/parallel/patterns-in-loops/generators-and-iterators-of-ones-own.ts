// Patterns in loops over what cannot be a list: a generator is closed where the pattern has taken its places (its `finally` runs), an iterator of one's own is asked for `return`, one that ends early is not.
const log: string[] = [];
function* count(limit: number): Generator<number> { try { for (let i = 0; i < limit; i++) yield i; } finally { log.push("closed " + limit); } }
class Own { constructor(public limit: number) {} [Symbol.iterator]() { let i = 0; const limit = this.limit; return { next: () => (i < limit ? { done: false, value: i++ } : { done: true, value: undefined }), return: () => { log.push("returned " + limit); return {}; } }; } }
const long = new Own(9), brief = new Own(1);
let sum = 0;
for (let i = 0; i < 200; i++) {
  const [a, b, c] = count(5);
  const [d, e = 50] = count(1); // @ts-expect-error
  const [f, g] = long;
  const [h, j = 70] = brief;
  sum += a! + b! + c! + d! + e + f! + g! + h! + j;
}
console.log(sum, log.length, log.slice(0, 8).join("|"));
