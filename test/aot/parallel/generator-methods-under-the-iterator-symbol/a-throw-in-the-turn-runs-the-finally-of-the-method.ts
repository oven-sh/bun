// A loop over an object with a generator method under Symbol.iterator: a throw in the turn runs the finally of the method.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations >= 1
const log: string[] = [];
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { try { for (const book of this.books) yield book; } finally { log.push("closed"); } } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) { if (book === 2) throw new RangeError("two"); sum += book; } return sum; }
for (let turn = 0; turn < 3; turn++) { try { console.log(total(new Shelf([1, turn, 3]))); } catch (error) { console.log((error as Error).message, log.join()); } }
