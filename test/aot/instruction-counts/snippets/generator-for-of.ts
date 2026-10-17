// iterates over a generator with for of
function* upTo(limit: number): Generator<number, void, void> {
  for (let n = 0; n < limit; n++) yield n;
}
const operations = 100;
let total = 0;

kernel: {
  for (const n of upTo(operations)) total += n;
}

console.log(total);
