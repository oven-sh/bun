// A loop over an object with a generator method under Symbol.iterator: a class below overrides the method.
// STATISTIC: GeneratorMethodsInlinedIntoIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
class Backwards extends Shelf { constructor(private mine: number[]) { super(mine); } *[Symbol.iterator]() { for (let i = this.mine.length - 1; i >= 0; i--) yield this.mine[i] * 10; } }
const shelves: Shelf[] = [new Shelf([1, 2, 3]), new Backwards([1, 2, 3])];
for (let turn = 0; turn < 4; turn++) console.log(total(shelves[turn & 1]));
