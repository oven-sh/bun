// collects with spread what a generator yields that was kept in an array
function* upTo(limit: number): Generator<number, void, void> {
  for (let n = 0; n < limit; n++) yield n;
}
const operations = 100;
const kept: Iterable<number>[] = [];
let total = 0;

kernel: {
  kept[0] = upTo(operations);
  total += [...kept[0]].length;
}

console.log(total);
