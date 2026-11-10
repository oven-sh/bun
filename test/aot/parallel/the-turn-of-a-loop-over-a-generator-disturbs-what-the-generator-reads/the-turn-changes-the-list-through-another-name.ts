// The loop of a generator is walked with the turn of its consumer inside it: the turn changes the list through another name.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
let other: number[] = [];
function total(shelf: Shelf): string { let sum = 0; let turns = 0; other = shelf.books; for (const book of shelf) { if (++turns > 12) break; if (book === 2) other.push(9), other[2] = 0.25; sum += book; } return sum + ":" + shelf.books.join(); }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, 2, 3, 4])));
