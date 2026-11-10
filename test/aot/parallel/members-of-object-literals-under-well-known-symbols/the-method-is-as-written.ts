// A member of an object literal under a well-known symbol: the method is as written.
// STATISTIC: IteratorMethodsCalledDirectly >= 1
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
for (let run = 0; run < 4; run++) console.log(sum(make(run)));
