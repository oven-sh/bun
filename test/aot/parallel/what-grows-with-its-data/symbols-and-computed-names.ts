// A symbol as a key, a computed method, Symbol.iterator written by hand.
// Sizes: 1000 4000 16000
// Passes: 45
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
const mark = Symbol("mark");
class Bag {
  [mark] = 1;
  items: number[];
  constructor(n: number) {
    this.items = [n, n + 1];
  }
  *[Symbol.iterator](): Generator<number> {
    yield* this.items;
  }
  ["sum" + "Of"](): number {
    let s = 0;
    for (const x of this) s += x;
    return s + this[mark];
  }
}
function once(): string {
  let sum = 0;
  for (let i = 0; i < size * 2; i++) sum += (new Bag(i & 7) as any).sumOf();
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
