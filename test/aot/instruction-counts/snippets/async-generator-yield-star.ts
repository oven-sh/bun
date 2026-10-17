// iterates over an async generator that delegates to an inner one with yield*
async function* upTo(limit: number): AsyncGenerator<number, void, void> {
  for (let n = 0; n < limit; n++) yield n;
}
async function* outer(limit: number): AsyncGenerator<number, void, void> {
  yield* upTo(limit);
}
const operations = 20;
let total = 0;

kernel: {
  for await (const n of outer(operations)) total += n;
}

console.log(total);
