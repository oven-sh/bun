// makes a generator, keeps it in an array, takes its first value with for of and leaves the loop
function* upTo(limit: number): Generator<number, void, void> {
  for (let n = 0; n < limit; n++) yield n;
}
const operations = 100;
const kept: Iterable<number>[] = [];
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    kept[0] = upTo(i + 2);
    for (const n of kept[0]) {
      total += n + i;
      break;
    }
  }
}

console.log(total);
