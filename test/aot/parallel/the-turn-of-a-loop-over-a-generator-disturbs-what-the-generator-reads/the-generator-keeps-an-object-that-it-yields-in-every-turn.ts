// The loop of a generator is walked with the turn of its consumer inside it: the generator keeps an object that it yields in every turn.
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { const cursor = { at: 0, seen: 0 }; for (const book of this.books) { cursor.at = book; yield cursor; cursor.seen += cursor.at; } yield cursor; } }
function told(shelf: Shelf): string { let out = ""; for (const cursor of shelf) { out += cursor.at + "/" + cursor.seen + ","; cursor.at *= 10; } return out; }
for (let run = 0; run < 2; run++) console.log(told(new Shelf([1, 2, 3 + run])));
