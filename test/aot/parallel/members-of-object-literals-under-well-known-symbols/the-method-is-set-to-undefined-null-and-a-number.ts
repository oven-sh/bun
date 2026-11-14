// A member of an object literal under a well-known symbol: the method is set to undefined null and a number.
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
for (const bad of [undefined, null, 7, "x"]) { const a = make(2); a[Symbol.iterator] = bad; console.log(sum(a)); }
