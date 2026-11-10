// A member of an object literal under a well-known symbol: the object is frozen and sealed.
// STATISTIC: IterationsOpenedByMethodsInSight >= 1
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
console.log(sum(Object.freeze(make(3))), sum(Object.seal(make(2))), sum(Object.preventExtensions(make(1))));
