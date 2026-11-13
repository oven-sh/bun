// A Set and a Map of which nothing is known serve as queues: a pattern takes the first member, which is then deleted, until none is left; now and then a member joins at the end. What was deleted in front is not looked at again at every take.
// Sizes: 1000 4000 16000
// Passes: 20
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);

(globalThis as any).shelfOfTheQueues = { waiting: new Set<number>(), owed: new Map<number, number>() };
const shelf: any = (globalThis as any).shelfOfTheQueues;

function once(): number {
  for (let i = 0; i < size; i++) {
    shelf.waiting.add(i);
    shelf.owed.set(i, i * 3);
  }
  let sum = 0,
    late = size;
  while (shelf.waiting.size) {
    const [first, second] = shelf.waiting;
    sum = (sum + first + (second ?? -1)) | 0;
    shelf.waiting.delete(first);
    if (first % 5 === 0 && late < size + size / 5) shelf.waiting.add(late++);
  }
  while (shelf.owed.size) {
    const [[key, value]] = shelf.owed;
    sum = (sum + key + value) | 0;
    shelf.owed.delete(key);
  }
  return sum;
}

let all = 0;
for (let pass = 0; pass < passes; pass++) all = (all + once()) | 0;
console.log(all);
