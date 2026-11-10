// A loop over an object with a generator method under Symbol.iterator: a break runs the finally of the method.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
const log: string[] = [];
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { try { for (const book of this.books) yield book; } finally { log.push("closed"); } } }
function first(shelf: Shelf): number { for (const book of shelf) { if (book > 1) return book; } return -1; }
for (let turn = 0; turn < 3; turn++) console.log(first(new Shelf([1, 2, 3])), first(new Shelf([0])), log.join());
