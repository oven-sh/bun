// A loop over an object with a generator method under Symbol.iterator: return is laid on the prototype of the method and the loop breaks.
// STATISTIC: GeneratorMethodsInlinedIntoIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function first(shelf: Shelf): number { for (const book of shelf) { if (book > 1) return book; } return -1; }
const shelf = new Shelf([1, 2, 3]);
console.log(first(shelf));
let closed = 0;
(Shelf.prototype[Symbol.iterator] as any).prototype.return = function (value: unknown) { closed++; return { done: true, value }; };
console.log(first(shelf), closed);
