// The loop of a generator is walked with the turn of its consumer inside it: a consumer copied in line returns and another throws out of the loop of the generator.
// STATISTIC: WalkLoopsVersioned >= 1
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function first(shelf: Shelf, least: number): number { for (const book of shelf) { if (book >= least) return book; } return -1; }
function guarded(shelf: Shelf): number { let sum = 0; try { for (const book of shelf) { if (book === 3) throw new Error("stop"); sum += book; } } catch { return -sum; } return sum; }
let total = 0;
for (let turn = 0; turn < 300; turn++) total += first(new Shelf([1, 2, 3, turn & 3]), 2 + (turn & 1)) + guarded(new Shelf([1, 2, (turn & 1) + 3, 5]));
console.log(total);
