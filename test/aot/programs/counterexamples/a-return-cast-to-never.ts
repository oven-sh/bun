// `return b as never` returns b.
declare const console: { log(...a: unknown[]): void };
function pick(a: { n: number }, b: { n: number }) { if (b.n) return b as never; return a; }
const x = { n: 1 }, y = { n: 2 };
console.log(pick(x, y) === y, pick(x, y) === x, pick(x, y).n);
