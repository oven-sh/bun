// creates an async generator object and never resumes it
async function* count(from: number): AsyncGenerator<number, void, void> {
  yield from;
}
const operations = 100;
let kept: AsyncGenerator<number, void, void> = count(0);

kernel: {
  for (let i = 0; i < operations; i++) kept = count(i);
}

console.log(typeof kept);
