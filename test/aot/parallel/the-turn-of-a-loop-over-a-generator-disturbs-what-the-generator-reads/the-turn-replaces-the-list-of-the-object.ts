// The loop of a generator is walked with the turn of its consumer inside it: the turn replaces the list of the object.
// STATISTIC: LoopsBuiltTwice >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): string { let sum = 0; let turns = 0; for (const book of shelf) { if (++turns > 12) break; if (book === 2) shelf.books = [50, 60, 70, 80, 90]; sum += book; } return sum + ":" + shelf.books.join(); }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, 2, 3, 4])));
