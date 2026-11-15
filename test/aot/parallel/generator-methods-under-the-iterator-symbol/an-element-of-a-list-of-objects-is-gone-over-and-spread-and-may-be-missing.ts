// A generator method under the iterator symbol: an element of a list of objects is gone over and spread and may be missing.
class Bag { constructor(private a: number[]) {} *[Symbol.iterator]() { for (const x of this.a) yield x; } }
const bags: Bag[] = [new Bag([1, 2])];
function sum(i: number) { let s = 0; for (const x of bags[i]) s += x; return s; }
function copy(i: number) { return [...bags[i]].length; }
for (const i of [0, 1]) for (const f of [sum, copy]) { try { console.log(f(i)); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); } }
