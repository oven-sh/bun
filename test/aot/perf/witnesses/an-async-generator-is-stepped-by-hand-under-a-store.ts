// With an AsyncLocalStorage in the program `await generator.next()` still costs what a turn of `for await` costs where the step is finished before the caller has to wait:
// the store that the await would keep is the one that is active.
import { AsyncLocalStorage } from "node:async_hooks";
const store = new AsyncLocalStorage<number>();
async function* numbers(count: number): AsyncGenerator<number, string, undefined> {
  for (let i = 0; i < count; i++) yield i + (store.getStore() ?? 0);
  return "end";
}
async function byHand(count: number): Promise<number> {
  const generator = numbers(count);
  let sum = 0;
  for (;;) {
    const { value, done } = await generator.next();
    if (done) return sum + value.length + (store.getStore() ?? 0);
    sum = (sum + value) | 0;
  }
}
async function main(): Promise<number> {
  const first = await store.run(1, () => byHand(60000));
  const both = await Promise.all([store.run(2, () => byHand(1000)), store.run(3, () => byHand(1000))]);
  return (first + both[0] + both[1]) | 0;
}
main().then(sum => console.log(sum));
