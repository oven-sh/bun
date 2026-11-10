// A generator method under the iterator symbol: a field that may be null holds the object that is gone over.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
class Bag { constructor(private a: number[]) {} *[Symbol.iterator]() { for (const x of this.a) yield x; } }
class Holder { bag: Bag | null = null; }
function sum(holder: Holder): string { try { let s = 0; for (const x of holder.bag!) s += x; return String(s); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } }
const full = new Holder(); full.bag = new Bag([1, 2, 3]);
for (let run = 0; run < 4; run++) console.log(sum(run & 1 ? new Holder() : full));
