// resumes a generator that delegates to an inner generator with yield*
function* naturals(): Generator<number, void, void> {
  for (let n = 0; ; n++) yield n;
}
function* outer(): Generator<number, void, void> {
  yield* naturals();
}
const operations = 100;
const numbers = outer();
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = numbers.next();
    if (result.done) break;
    total += result.value;
  }
}

console.log(total);
