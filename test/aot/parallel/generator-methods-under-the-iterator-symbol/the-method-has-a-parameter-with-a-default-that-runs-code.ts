// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: the method has a parameter with a default that runs code.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
const log: string[] = [];
function note(text: string): number { log.push(text); return 1; }
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator](step = note("default")) { log.push("body"); for (let place = 0; place < this.books.length; place += step) yield this.books[place]; } }
function total(shelf: Shelf): number { let sum = 0; log.push("open"); for (const book of shelf) { log.push("turn"); sum += book; } return sum; }
for (let turn = 0; turn < 2; turn++) console.log(total(new Shelf([1, turn])), log.join());
