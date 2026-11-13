// The loop of a generator is walked with the turn of its consumer inside it: a variable that a closure holds is stored in the turn.
// STATISTIC: WalkLoopsVersioned >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): string { let sum = 0; const read = () => sum; let seen = ""; for (const book of shelf) { sum += book; seen += read() + ","; } return seen; }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, 2, run])));
