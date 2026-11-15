// A member of an object literal under a well-known symbol: the generator method of a literal a copy by spread keeps the method and its own field.
function make(k: number): any { return { k, *[Symbol.iterator]() { for (let i = 0; i < this.k; i++) yield i + 1; } }; }
function sum(l: any): string { try { let s = 0; for (const x of l) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const a = make(2), b = { ...a, k: 4 }; console.log(sum(a), sum(b), sum(Object.create(a)), sum(Object.assign(Object.create(null), a)));
