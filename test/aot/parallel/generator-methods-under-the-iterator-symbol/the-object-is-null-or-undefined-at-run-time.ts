// A loop over an object with a generator method under Symbol.iterator: the object is null or undefined at run time.
class Shelf { constructor(private books: number[]) {} *[Symbol.iterator]() { for (const book of this.books) yield book; } }
function total(shelf: Shelf): number { let sum = 0; for (const book of shelf) sum += book; return sum; }
const shelves: any[] = [new Shelf([1]), null, undefined, 5];
for (const shelf of shelves) { try { console.log(total(shelf)); } catch (error) { console.log((error as Error).constructor.name); } }
