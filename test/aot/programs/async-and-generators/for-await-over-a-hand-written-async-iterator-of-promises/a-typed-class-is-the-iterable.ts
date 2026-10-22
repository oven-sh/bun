class Batches implements AsyncIterable<Promise<number>> {
  [Symbol.asyncIterator](): AsyncIterator<Promise<number>> { let i = 0; return { next: async () => (i++ < 2 ? { done: false, value: Promise.resolve(i) } : { done: true, value: undefined }) }; }
}
const got: unknown[] = [];
for await (const p of new Batches()) got.push(p);
console.log(got.length, got.map(x => typeof x + (x instanceof Promise)).join(), await Promise.all(got as Promise<number>[]));
