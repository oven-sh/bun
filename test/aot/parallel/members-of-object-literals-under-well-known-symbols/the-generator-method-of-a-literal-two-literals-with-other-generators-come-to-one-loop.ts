// A member of an object literal under a well-known symbol: the generator method of a literal two literals with other generators come to one loop.
function sum(l: any): number { let s = 0; for (const x of l) s += x; return s; }
const a = { *[Symbol.iterator]() { yield 1; yield 2; } }, b = { *[Symbol.iterator]() { yield 10; } };
for (let run = 0; run < 4; run++) console.log(sum(run & 1 ? a : b));
