// A Set and a Map of which nothing is known serve as a queue and as a cache that drops its oldest: the first member is asked of a new iterator by `next` and deleted, until none is left, in the four ways programs write it. What was deleted in front is not looked at again at every call.
// Sizes: 1000 4000 16000
// Passes: 10
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

(globalThis as any).shelfOfTheOldest = { waiting: new Set<number>(), cache: new Map<number, number>() };
const shelf: any = (globalThis as any).shelfOfTheOldest;

function fill(): void {
  for (let i = 0; i < size; i++) {
    shelf.waiting.add(i);
    shelf.cache.set(i, i * 3);
  }
}

function once(): number {
  let sum = 0;
  fill();
  while (shelf.waiting.size) {
    const first = shelf.waiting.values().next().value;
    sum = (sum + first) | 0;
    shelf.waiting.delete(first);
  }
  while (shelf.cache.size) {
    const oldest = shelf.cache.keys().next().value;
    sum = (sum + oldest) | 0;
    shelf.cache.delete(oldest);
  }
  fill();
  while (shelf.waiting.size) {
    const first = shelf.waiting[Symbol.iterator]().next().value;
    sum = (sum + first) | 0;
    shelf.waiting.delete(first);
  }
  while (shelf.cache.size) {
    const [key, value] = shelf.cache.entries().next().value;
    sum = (sum + key + value) | 0;
    shelf.cache.delete(key);
  }
  // A cache of a fixed size: each new key drops the oldest.
  for (let i = 0; i < size; i++) shelf.cache.set(i, i);
  for (let i = size; i < size * 3; i++) {
    shelf.cache.delete(shelf.cache.keys().next().value);
    shelf.cache.set(i, i);
  }
  sum = (sum + shelf.cache.keys().next().value + shelf.cache.size) | 0;
  shelf.cache.clear();
  return sum;
}

let all = 0;
for (let pass = 0; pass < passes; pass++) all = (all + once()) | 0;
console.log(all);
