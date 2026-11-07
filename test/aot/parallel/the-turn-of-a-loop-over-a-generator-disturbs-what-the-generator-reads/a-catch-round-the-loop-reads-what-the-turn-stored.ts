// The loop of a generator is walked with the turn of its consumer inside it: a catch round the loop reads what the turn stored.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function told(shelf: Shelf): string { const box = { n: 0 }; let out = ""; try { for (const book of shelf) { box.n = book; if (book === 2) throw new RangeError("two"); out += book; } } catch (error) { out += (error as Error).message + box.n; } return out; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
