// A loop over an object with a generator method under Symbol.iterator: the method is replaced on the class at run time.
// STATISTIC: GeneratorMethodsInlinedIntoIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([1, 2, 3]);
console.log(total(shelf));
(Shelf.prototype as any)[Symbol.iterator] = function* () { yield 100; };
console.log(total(shelf));
