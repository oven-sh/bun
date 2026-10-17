// creates a generator object and resumes it once, up to its first yield
function* count(from: number): Generator<number, void, void> {
  yield from;
  yield from + 1;
}
const operations = 100;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const result = count(i).next();
    if (!result.done) total += result.value;
  }
}

console.log(total);
