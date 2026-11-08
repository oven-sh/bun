const enum Tint { None = 0, Red = 1, Blue = 2 }
class Stamp { ink: string; constructor(ink: string) { this.ink = ink; } }
interface Ledger { tint: Tint; shade: Tint; gloss: Tint; quill?: Stamp; vellum?: Stamp; wax?: Stamp; twine?: Stamp; }
const LedgerMaker = function (this: Ledger) { this.tint = Tint.None; this.shade = Tint.Red; this.gloss = Tint.Blue; } as unknown as new () => Ledger;
function fill(book: Ledger, n: number) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  book.quill = new Stamp("q" + n);
  if (n & 1) book.vellum = new Stamp("v" + n);
  if (n & 2) book.wax = new Stamp("w" + n);
  if (n & 4) book.twine = new Stamp("t" + n);
  return work;
}
function litter(n: number) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const heap: string[][] = [];
  for (let i = 0; i < 40; i++) heap.push(["x" + n, "y" + i, "z" + work]);
  return heap.length;
}
function wrongIn(book: Ledger, n: number) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let wrong = book.quill && book.quill.ink === "q" + n ? 0 : 1;
  wrong += (n & 1 ? book.vellum !== undefined && book.vellum.ink === "v" + n : book.vellum === undefined) ? 0 : 1;
  wrong += (n & 2 ? book.wax !== undefined && book.wax.ink === "w" + n : book.wax === undefined) ? 0 : 1;
  wrong += (n & 4 ? book.twine !== undefined && book.twine.ink === "t" + n : book.twine === undefined) ? 0 : 1;
  return wrong + Object.keys(book).length - 4 - (n & 1) - ((n >> 1) & 1) - ((n >> 2) & 1) + work - 1;
}
function elsewhere(bag: any) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return "" + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + bag.thong + work;
}
function run(count: number) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const kept: Ledger[] = []; let made = 0, wrong = 0;
  for (let i = 0; i < count; i++) {
    const book = i % 3 ? new LedgerMaker() : (Reflect.construct(LedgerMaker, []) as Ledger);
    fill(book, i); kept.push(book); made += litter(i);
  }
  for (let i = 0; i < count; i++) wrong += wrongIn(kept[i], i);
  return wrong + " " + kept.length + " " + made + " " + work + " " + elsewhere(JSON.parse('{"thong":1}'));
}
console.log(run(20000));
