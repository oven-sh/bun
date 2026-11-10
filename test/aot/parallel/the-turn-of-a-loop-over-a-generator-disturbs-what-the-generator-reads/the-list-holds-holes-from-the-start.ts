// The loop of a generator is walked with the turn of its consumer inside it: the list holds holes from the start.
// STATISTIC: LoopsBuiltTwice >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): string { let sum = 0; let turns = 0; for (const book of shelf) { if (++turns > 12) break;  sum += book; } return String(sum); }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, , 3, , 5] as number[])));
