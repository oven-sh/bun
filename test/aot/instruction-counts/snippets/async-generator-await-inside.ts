// iterates over an async generator that awaits an async function before every yield
async function double(x: number): Promise<number> {
  return x * 2;
}
async function* doubles(limit: number): AsyncGenerator<number, void, void> {
  for (let n = 0; n < limit; n++) yield await double(n);
}
const operations = 20;
let total = 0;

kernel: {
  for await (const n of doubles(operations)) total += n;
}

console.log(total);
