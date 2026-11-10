// The loop of a generator is walked with the turn of its consumer inside it: lists of three storages arrive at one loop.
// STATISTIC: LoopsBuiltTwice >= 1
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): string { let sum = 0; for (const book of shelf) sum += book; return String(sum); }
const lists: number[][] = [[1, 2, 3], [0.5, 1.5], [1, , 3] as number[], [], ["a", 2] as unknown as number[]];
for (let run = 0; run < 10; run++) console.log(total(new Shelf(lists[run % 5])));
