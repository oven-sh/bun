// A loop over an object with a generator method under Symbol.iterator: the prototype property of the method is replaced.
// STATISTIC: GeneratorMethodsInlinedIntoIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([1, 2, 3]);
console.log(total(shelf));
(Shelf.prototype[Symbol.iterator] as any).prototype = { next() { return { done: true, value: undefined }; } };
console.log(total(shelf));
