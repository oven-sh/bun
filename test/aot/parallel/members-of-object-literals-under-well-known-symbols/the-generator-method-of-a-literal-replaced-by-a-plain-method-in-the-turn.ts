// A member of an object literal under a well-known symbol: the generator method of a literal replaced by a plain method in the turn.
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(4); let s = 0; for (const x of a) { s += x; if (x === 2) a[Symbol.iterator] = () => [9][Symbol.iterator](); } console.log(s, sum(a));
