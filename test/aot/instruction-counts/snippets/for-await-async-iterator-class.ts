// iterates with for await over a class whose next() is an async method
class Counter implements AsyncIterableIterator<number> {
  private n = 0;
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  async next(): Promise<IteratorResult<number, undefined>> {
    if (this.n >= this.limit) return { value: undefined, done: true };
    return { value: this.n++, done: false };
  }
  [Symbol.asyncIterator](): Counter {
    return this;
  }
}
const operations = 20;
let total = 0;

kernel: {
  for await (const n of new Counter(operations)) total += n;
}

console.log(total);
