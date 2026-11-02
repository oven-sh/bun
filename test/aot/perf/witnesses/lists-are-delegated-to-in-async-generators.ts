// `yield*` and `for await` over a list in an async generator make no wrapper around the list's iterator and call nothing: each value is awaited where the wrapper would await it.
async function* nothing(): AsyncGenerator<number> { yield* []; }
async function* few(base: number): AsyncGenerator<number> { yield* [base, base + 1, base + 2]; }
async function* loops(list: number[]): AsyncGenerator<number> { for await (const value of list) yield value * 2; }
async function main(): Promise<number> {
  let sum = 0;
  const list = [1, 2, 3];
  for (let i = 0; i < 20000; i++) {
    for await (const value of nothing()) sum += value;
    for await (const value of few(i)) sum = (sum + value) | 0;
    for await (const value of loops(list)) sum = (sum + value) | 0;
  }
  return sum;
}
main().then(sum => console.log(sum));
