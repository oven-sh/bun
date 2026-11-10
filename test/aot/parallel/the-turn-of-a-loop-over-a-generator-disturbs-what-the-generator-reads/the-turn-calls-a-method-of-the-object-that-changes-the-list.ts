// The loop of a generator is walked with the turn of its consumer inside it: the turn calls a method of the object that changes the list.
class Shelf { constructor(public books: number[]) {} add(book: number) { this.books.push(book); this.books[0] = -1; } *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function told(shelf: Shelf): string { let out = ""; let turns = 0; for (const book of shelf) { out += book + ","; if (++turns < 3) shelf.add(0.5); } return out; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
