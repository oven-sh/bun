// sends a value into a generator with next(value) and reads what it yields back
function* accumulate(): Generator<number, void, number> {
  let sum = 0;
  for (;;) sum += yield sum;
}
const operations = 100;
const sums = accumulate();
sums.next(0);
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = sums.next(i);
    if (result.done) break;
    total = result.value;
  }
}

console.log(total);
