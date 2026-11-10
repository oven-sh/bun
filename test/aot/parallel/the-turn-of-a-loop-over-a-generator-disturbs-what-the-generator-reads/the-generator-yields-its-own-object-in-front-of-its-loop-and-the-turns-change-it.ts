// The loop of a generator is walked with the turn of its consumer inside it: the generator yields its own object in front of its loop and the turns change it.
class Shelf {
  total = -1;
  constructor(private books: number[]) {}
  *[Symbol.iterator](): Generator<any> { const box = { v: 0 }; yield box; for (const book of this.books) yield book; this.total = box.v; }
}
function drain(shelf: Shelf): number {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let keep: any = null;
  for (const x of shelf) { if (keep === null) keep = x; else keep.v += x; }
  return shelf.total + work - 1;
}
console.log(drain(new Shelf([1, 2, 3])), drain(new Shelf([4, 5])));
