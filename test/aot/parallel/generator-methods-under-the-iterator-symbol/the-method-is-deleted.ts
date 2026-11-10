// A loop over an object with a generator method under Symbol.iterator: the method is deleted.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([1, 2, 3]);
console.log(total(shelf));
delete (Shelf.prototype as any)[Symbol.iterator];
try { console.log(total(shelf)); } catch (error) { console.log((error as Error).constructor.name); }
