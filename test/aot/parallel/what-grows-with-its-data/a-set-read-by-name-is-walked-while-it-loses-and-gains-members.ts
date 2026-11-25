// A Set, a Map and a text are read by name off an object of which nothing is known, and walked: the Set loses and gains members under the walk, the Map is walked by its values, and a list arrives under the Set's name too.
// Sizes: 250 1000 4000
// Passes: 400
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

const kept = { items: new Set<number>(), pairs: new Map<number, number>(), words: "" };
(globalThis as any).keptForTheWalk = kept;
const holder: any = (globalThis as any).keptForTheWalk;
const other: any = JSON.parse('{"items":[]}');

function once(): number {
  const items = new Set<number>(),
    pairs = new Map<number, number>();
  let words = "";
  other.items.length = 0;
  for (let i = 0; i < size; i++) {
    items.add(i);
    pairs.set(i, i * 2);
    words += String.fromCharCode(97 + (i % 26));
    other.items.push(i);
  }
  holder.items = items;
  holder.pairs = pairs;
  holder.words = words;
  let sum = 0;
  for (const item of holder.items) {
    sum = (sum + item) | 0;
    if (item < size && item & 1) {
      holder.items.delete(item);
      holder.items.add(item + size);
    }
  }
  for (const value of holder.pairs.values()) sum = (sum + value) | 0;
  for (const word of holder.words) sum = (sum + word.length) | 0;
  for (const item of other.items) sum = (sum + item) | 0;
  return sum + [...holder.items].length;
}

let told = 0;
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
