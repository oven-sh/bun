// Callbacks handed over: find, findIndex, findLast, Array.from and a spread visit the holes of an Array<number> as undefined, and Array.from does so for an array-like without elements; the program's own calls pass numbers.
let total = 0;

function isBig(value: number): boolean {
  total += typeof value === "number" ? 1 : value === undefined ? 100 : 10000;
  return value > 5;
}

isBig(1);
const holes = new Array<number>(3);
holes[1] = 4;
const like: ArrayLike<number> = { length: 2 };
const results: unknown[] = [
  holes.find(isBig),
  holes.findIndex(isBig),
  holes.findLast(isBig),
  holes.filter(isBig).length,
  holes.some(isBig),
  Array.from(holes, isBig).length,
  Array.from(like, isBig).length,
  [...holes].map(isBig).length,
  holes.toSorted().map(isBig).length,
];
console.log(total, results.join());
