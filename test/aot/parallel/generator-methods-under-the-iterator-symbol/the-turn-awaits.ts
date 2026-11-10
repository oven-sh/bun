// A loop over an object with a generator method under Symbol.iterator: the turn awaits.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
async function total(shelf: Shelf): Promise<number> { let sum = 0; for (const book of shelf) sum += await Promise.resolve(book); return sum; }
for (let turn = 0; turn < 3; turn++) console.log(await total(new Shelf([1, 2, turn])));
