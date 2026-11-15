// A loop over an object with a generator method under Symbol.iterator: an object of another class arrives under a lie.
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
class Other { *[Symbol.iterator]() { yield 40; yield 2; } }
const shelves: any[] = [new Shelf([1]), new Other(), [5, 6], new Set([7]), "89"];
for (const shelf of shelves) { try { console.log(String(total(shelf))); } catch (error) { console.log((error as Error).constructor.name); } }
