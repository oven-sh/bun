// A loop over an object with a generator method under Symbol.iterator: the loop stands in a generator that yields in the turn.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function* doubled(shelf: Shelf) { for (const book of shelf) yield book * 2; }
function total(shelf: Shelf): number { let sum = 0; for (const book of doubled(shelf)) sum += book; return sum; }
for (let turn = 0; turn < 3; turn++) console.log(total(new Shelf([1, 2, turn])));
