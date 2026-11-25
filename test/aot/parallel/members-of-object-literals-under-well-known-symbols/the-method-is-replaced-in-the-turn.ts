// A member of an object literal under a well-known symbol: the method is replaced in the turn.
function make(k: number): any { return { [Symbol.iterator]() { let i = 0; return { next() { return i < k ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(4); let s = 0; for (const x of a) { s += x; if (x === 2) a[Symbol.iterator] = () => [9][Symbol.iterator](); } console.log(s, sum(a));
