// creates a generator object and never resumes it
function* count(from: number): Generator<number, void, void> {
  yield from;
  yield from + 1;
}
const operations = 100;
let kept: Generator<number, void, void> = count(0);

kernel: {
  for (let i = 0; i < operations; i++) kept = count(i);
}

console.log(kept.next().value);
