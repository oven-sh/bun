// The loop of a generator is walked with the turn of its consumer inside it: the turn stores a variable of the module that the method reads each turn.
let factor = 1;
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book * factor; } }
function told(shelf: Shelf): string { let out = ""; factor = 1; for (const book of shelf) { out += book + ","; factor++; } return out; }
for (let run = 0; run < 3; run++) console.log(told(new Shelf([1, 2, 3 + run])));
