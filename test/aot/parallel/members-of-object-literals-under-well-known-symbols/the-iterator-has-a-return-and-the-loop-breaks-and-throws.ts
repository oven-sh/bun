// A member of an object literal under a well-known symbol: the iterator has a return and the loop breaks and throws.
// STATISTIC: IterationsOpenedByMethodsInSight >= 1
const told: string[] = [];
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; }, return(v: unknown) { told.push("closed at " + i); return { value: v, done: true }; } }; } }; }
function first(l: any): number { for (const x of l) if (x === 2) return x; return -1; }
function fails(l: any): string { try { for (const x of l) if (x === 3) throw new Error("three"); return "none"; } catch (e) { return (e as Error).message; } }
console.log(first(make(5)), fails(make(5)), first(make(1)), told.join());
