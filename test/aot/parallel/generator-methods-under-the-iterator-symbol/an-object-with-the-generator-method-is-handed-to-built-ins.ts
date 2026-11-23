// What a loop, a spread or a pattern calls under Symbol.iterator, next and return: an object with the generator method is handed to built ins.
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelf = new Shelf([3, 1, 2]);
console.log(Array.from(shelf).join(), new Set(shelf).size, Math.max(...shelf), new Map([[1, shelf]]).get(1) === shelf, total(shelf), Promise.all(shelf) instanceof Promise);
