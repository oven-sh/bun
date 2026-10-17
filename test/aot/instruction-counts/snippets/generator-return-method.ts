// creates a generator, resumes it once and ends it with return(), which runs a finally block
let closed = 0;
function* guarded(from: number): Generator<number, void, void> {
  try {
    yield from;
    yield from + 1;
  } finally {
    closed++;
  }
}
const operations = 100;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const numbers = guarded(i);
    const result = numbers.next();
    if (!result.done) total += result.value;
    numbers.return();
  }
}

console.log(total, closed);
