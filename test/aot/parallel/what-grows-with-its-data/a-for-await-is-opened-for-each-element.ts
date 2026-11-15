// A short `for await` is opened, stepped and left for each element: over an async generator, a list and an iterator of the program's own.
// Sizes: 1000 4000 16000
// Passes: 20
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
async function* pair(first: number): AsyncGenerator<number> {
  yield first;
  yield first + 1;
  yield first + 2;
}
function countdown(from: number): AsyncIterable<number> {
  return {
    [Symbol.asyncIterator]() {
      let left = from;
      return { next: async () => (left > 0 ? { done: false, value: left-- } : { done: true, value: 0 }) };
    },
  };
}
async function once(): Promise<number> {
  let sum = 0;
  for (let i = 0; i < size; i++) {
    for await (const value of pair(i & 7)) {
      if (value > 8) break;
      sum = (sum + value) | 0;
    }
    for await (const value of [i & 3, 1]) sum = (sum + value) | 0;
    for await (const value of countdown(2)) sum = (sum + value) | 0;
  }
  return sum;
}
let told = 0;
for (let pass = 0; pass < passes; pass++) told = await once();
console.log(told);
