// A loop over an object with a generator method under Symbol.iterator: next is laid on the prototype of a generator made by hand.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([1, 2, 3]);
console.log(total(shelf));
Object.getPrototypeOf(shelf[Symbol.iterator]()).next = function () { return { done: true, value: undefined }; };
console.log(total(shelf));
