// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: the generator method is laid on another class.
// STATISTIC: GeneratorMethodsInlinedIntoIterations = 0
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
class Other { books = [7, 8]; }
(Other.prototype as any)[Symbol.iterator] = Shelf.prototype[Symbol.iterator];
let sum = 0; for (const book of new Other() as any) sum += book;
console.log(total(new Shelf([1, 2])), sum);
