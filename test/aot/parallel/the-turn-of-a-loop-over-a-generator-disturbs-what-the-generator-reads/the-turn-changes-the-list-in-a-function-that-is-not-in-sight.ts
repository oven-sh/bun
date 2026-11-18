// The loop of a generator is walked with the turn of its consumer inside it: the turn changes the list in a function that is not in sight.
class Shelf { constructor(public books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
const deeds: ((shelf: Shelf) => void)[] = [shelf => { shelf.books[3] = 0.75; }, shelf => { shelf.books.push(40); }];
function total(shelf: Shelf): string { let sum = 0; let turns = 0; for (const book of shelf) { if (++turns > 12) break; if (book === 2) deeds[turns & 1](shelf); sum += book; } return sum + ":" + shelf.books.join(); }
for (let run = 0; run < 3; run++) console.log(total(new Shelf([1, 2, 3, 4])));
