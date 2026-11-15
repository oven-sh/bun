// The loop of a generator is walked with the turn of its consumer inside it: the turns add and delete fields of an object of the generators own.
class Shelf { told = ""; constructor(private books: number[]) {} *[Symbol.iterator](): Generator<number | { v?: number }> { const box: { v?: number; extra?: number } = { v: 0 }; yield box; for (const book of this.books) yield book; this.told = box.v + ":" + box.extra + ":" + Object.keys(box).join(); } }
function told(shelf: Shelf): string { let keep: any = null; for (const x of shelf) { if (keep === null) keep = x; else if (x === 1) keep.extra = 1; else delete keep.v; } return shelf.told; }
for (let run = 0; run < 2; run++) console.log(told(new Shelf([1, 2, 3 + run])));
