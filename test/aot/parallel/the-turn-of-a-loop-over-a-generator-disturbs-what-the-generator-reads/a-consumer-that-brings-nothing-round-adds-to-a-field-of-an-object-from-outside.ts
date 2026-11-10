// The loop of a generator is walked with the turn of its consumer inside it: a consumer that brings nothing round adds to a field of an object from outside.
// STATISTIC: LoopsBuiltTwice >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
const sums = { total: 0, turns: 0 };
function add(shelf: Shelf): void { for (const book of shelf) { sums.total += book; sums.turns++; } }
const lists: number[][] = [[1, 2, 3], [0.5, 1.5], [1, , 3] as number[], [], ["a", 2] as unknown as number[]];
for (let run = 0; run < 10; run++) { add(new Shelf(lists[run % 5])); console.log(String(sums.total), sums.turns); }
