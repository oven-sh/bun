// The loop of a generator is walked with the turn of its consumer inside it: the turn changes the list under a type that says nothing.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
let hidden: unknown;
function total(shelf: Shelf): string { let sum = 0; let turns = 0; hidden = shelf; for (const book of shelf) { if (++turns > 12) break; if (book === 2) (hidden as any).books[2] = "y"; sum += book; } return String(sum); }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, 2, 3, 4])));
