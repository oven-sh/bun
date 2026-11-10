// A loop over an object with a generator method under Symbol.iterator: an accessor is defined in place of the method.
// STATISTIC: GeneratorMethodsInlinedIntoIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([1, 2, 3]);
console.log(total(shelf));
let reads = 0;
Object.defineProperty(Shelf.prototype, Symbol.iterator, { configurable: true, get() { reads++; return function* () { yield 5; }; } });
console.log(total(shelf), reads);
