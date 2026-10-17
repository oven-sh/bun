// iterates over an async generator with for await
async function* upTo(limit: number): AsyncGenerator<number, void, void> {
  for (let n = 0; n < limit; n++) yield n;
}
const operations = 20;
let total = 0;

kernel: {
  for await (const n of upTo(operations)) total += n;
}

console.log(total);
