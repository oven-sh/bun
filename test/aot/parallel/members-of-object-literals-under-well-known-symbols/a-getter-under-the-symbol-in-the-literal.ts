// A member of an object literal under a well-known symbol: a getter under the symbol in the literal.
let reads = 0;
const o: any = { get [Symbol.iterator]() { reads++; return function* () { yield reads; yield 2; }; } };
function sum(l: any): number { let s = 0; for (const x of l) s += x; return s; }
for (let run = 0; run < 3; run++) console.log(sum(o), reads);
