// The loop of a generator is walked with the turn of its consumer inside it: the turn pushes onto the list.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): string { let sum = 0; let turns = 0; for (const book of shelf) { if (++turns > 12) break; if (shelf.books.length < 7) shelf.books.push(book + 10); sum += book; } return sum + ":" + shelf.books.join(); }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, 2, 3, 4])));
