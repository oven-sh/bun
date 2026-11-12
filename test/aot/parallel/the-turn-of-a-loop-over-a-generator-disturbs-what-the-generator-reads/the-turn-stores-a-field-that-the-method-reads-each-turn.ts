// The loop of a generator is walked with the turn of its consumer inside it: the turn stores a field that the method reads each turn.
class Shelf { factor = 1; constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book * this.factor; } }
function told(shelf: Shelf): string { let out = ""; for (const book of shelf) { out += book + ","; shelf.factor++; } return out; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
