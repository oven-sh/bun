// collects what a generator yields into an array with spread
function* upTo(limit: number): Generator<number, void, void> {
  for (let n = 0; n < limit; n++) yield n;
}
const operations = 100;
let total = 0;

kernel: {
  total += [...upTo(operations)].length;
}

console.log(total);
