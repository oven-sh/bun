// A loop over an object with a generator method under Symbol.iterator: the object is spread into a list and into a call.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function spread(shelf: Shelf): string { const all = [0, ...shelf, 9]; return all.join() + ":" + Math.max(...shelf); }
for (let turn = 0; turn < 3; turn++) console.log(spread(new Shelf([1, turn, 3])));
