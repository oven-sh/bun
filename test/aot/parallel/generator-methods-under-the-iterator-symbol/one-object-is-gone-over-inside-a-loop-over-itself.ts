// A loop over an object with a generator method under Symbol.iterator: one object is gone over inside a loop over itself.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function products(shelf: Shelf): number { let sum = 0; for (const one of shelf) for (const other of shelf) sum += one * other; return sum; }
for (let turn = 0; turn < 3; turn++) console.log(products(new Shelf([1, 2, turn])));
