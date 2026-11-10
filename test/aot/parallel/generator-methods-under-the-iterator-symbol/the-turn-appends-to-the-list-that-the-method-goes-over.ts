// A loop over an object with a generator method under Symbol.iterator: the turn appends to the list that the method goes over.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) { if (shelf.books.length < 6) shelf.books.push(book * 2); sum += book; } return sum; }
for (let turn = 0; turn < 3; turn++) console.log(total(new Shelf([1, 2, 3])));
