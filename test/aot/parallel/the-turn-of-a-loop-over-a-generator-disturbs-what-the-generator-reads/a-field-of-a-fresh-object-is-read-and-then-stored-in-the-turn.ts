// The loop of a generator is walked with the turn of its consumer inside it: a field of a fresh object is read and then stored in the turn.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function told(shelf: Shelf): string { const box = { n: 1 }; let out = ""; for (const book of shelf) { out += box.n + ","; box.n = box.n + book; } return out + box.n; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
