// The loop of a generator is walked with the turn of its consumer inside it: a fresh shelf and a fresh list are gone over and changed.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(run: number): string { const shelf = new Shelf([1, 2, run]); let sum = 0; for (const book of shelf) { if (book === 2) { shelf.books.push(0.5); shelf.books[0] = 9; } sum += book; } return sum + ":" + shelf.books.join(); }
for (let run = 0; run < 3; run++) console.log(total(run));
