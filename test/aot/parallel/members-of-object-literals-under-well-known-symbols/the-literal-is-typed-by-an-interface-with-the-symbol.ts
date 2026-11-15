// A member of an object literal under a well-known symbol: the literal is typed by an interface with the symbol.
interface Walk { k: number; [Symbol.iterator](): Iterator<number>; }
const make = (k: number): Walk => ({ k, [Symbol.iterator]() { let i = 0; const most = this.k; return { next() { return i < most ? { value: ++i, done: false } : { value: undefined, done: true }; } }; } });
function sum(l: Walk): number { let s = 0; for (const x of l) s += x; return s; }
const lists: Walk[] = [make(2), make(3), [4, 5] as unknown as Walk];
for (const l of lists) console.log(sum(l));
