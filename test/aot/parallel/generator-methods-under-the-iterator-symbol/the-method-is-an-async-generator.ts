// A loop over an object with a generator method under Symbol.iterator: the method is an async generator.
// STATISTIC: GeneratorMethodsWalkedInPlaceOfIterations = 0
class Shelf { constructor(private books: number[]) {} async *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function count(shelf: any): string { let turns = 0; let kinds = ""; for (const book of shelf) { kinds += typeof book; if (++turns === 3) break; } return kinds; }
console.log(count(new Shelf([1, 2, 3])));
