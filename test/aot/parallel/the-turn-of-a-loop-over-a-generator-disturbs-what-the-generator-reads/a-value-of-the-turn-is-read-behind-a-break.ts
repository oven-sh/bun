// The loop of a generator is walked with the turn of its consumer inside it: a value of the turn is read behind a break.
// STATISTIC: WalkLoopsVersioned >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function find(shelf: Shelf, wanted: number): string { let found = -1; for (const book of shelf) { const doubled = book * 2; if (doubled > wanted) { found = doubled; break; } } return String(found); }
for (let run = 0; run < 4; run++) console.log(find(new Shelf([1, 2, 3, 0.5]), run * 2));
