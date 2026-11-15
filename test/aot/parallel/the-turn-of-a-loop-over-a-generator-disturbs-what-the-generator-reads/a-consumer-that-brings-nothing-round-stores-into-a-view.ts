// The loop of a generator is walked with the turn of its consumer inside it: a consumer that brings nothing round stores into a view.
// STATISTIC: WalkLoopsVersioned >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
const seen = new Float64Array(8);
function mark(shelf: Shelf): void { for (const book of shelf) seen[book & 7] += book; }
const lists: number[][] = [[1, 2, 3], [0.5, 9.5], [1, , 3] as number[], [7]];
for (let run = 0; run < 8; run++) { mark(new Shelf(lists[run % 4])); console.log(seen.join()); }
