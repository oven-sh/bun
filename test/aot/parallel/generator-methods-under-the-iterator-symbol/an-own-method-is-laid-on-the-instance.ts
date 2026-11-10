// A loop over an object with a generator method under Symbol.iterator: an own method is laid on the instance.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([1, 2, 3]);
const other = new Shelf([4, 5]);
console.log(total(shelf), total(other));
(shelf as any)[Symbol.iterator] = function* () { yield 100; };
console.log(total(shelf), total(other));
