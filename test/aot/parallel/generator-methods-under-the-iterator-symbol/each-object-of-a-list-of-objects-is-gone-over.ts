// A generator method under the iterator symbol: each object of a list of objects is gone over.
class Bag { constructor(private a: number[]) {} *[Symbol.iterator]() { for (const x of this.a) yield x; } }
function sum(bags: Bag[]): number { let s = 0; for (const bag of bags) for (const x of bag) s += x; return s; }
for (let run = 0; run < 3; run++) console.log(sum([new Bag([1, 2]), new Bag([run]), new Bag([])]));
try { console.log(sum([new Bag([1]), undefined as unknown as Bag])); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
