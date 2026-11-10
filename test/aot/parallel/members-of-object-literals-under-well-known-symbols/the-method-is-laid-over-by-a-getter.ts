// A member of an object literal under a well-known symbol: the method is laid over by a getter.
// STATISTIC: IterationsOpenedByMethodsInSight >= 1
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(3), b = make(3); let reads = 0; const under = [Symbol.iterator, Symbol.asyncIterator][process.argv.length > 99 ? 1 : 0]; Object.defineProperty(b, under, { get() { reads++; return function* () { yield reads; }; } }); for (let run = 0; run < 4; run++) console.log(sum(run & 1 ? b : a), reads);
