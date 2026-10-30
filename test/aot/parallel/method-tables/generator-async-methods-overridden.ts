// Generator methods, async methods and an async generator method are overridden in a family, with super inside. One call site each sees all classes. Then they are replaced on the prototypes by other functions of their kind and by plain functions that answer an iterator or a promise.
class Source {
  constructor(public start: number) {}
  *items(): IterableIterator<number> {
    yield this.start;
    yield this.start + 1;
  }
  async load(): Promise<number> {
    return this.start * 10;
  }
  async *stream(): AsyncGenerator<number> {
    yield await this.load();
    yield this.start;
  }
}
class More extends Source {
  *items(): IterableIterator<number> {
    yield* super.items();
    yield 300;
  }
  async load(): Promise<number> {
    return (await super.load()) + 5;
  }
}
class Other extends Source {
  *items(): IterableIterator<number> {
    yield 900;
  }
}
class Same extends Source {}

function drain(source: Source): number {
  let sum = 0;
  for (const item of source.items()) sum += item;
  return sum;
}
async function loadOf(source: Source): Promise<number> {
  return (await source.load()) + 1;
}
async function follow(source: Source): Promise<number> {
  let sum = 0;
  for await (const item of source.stream()) sum += item;
  return sum;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const sources: Source[] = [new Source(1), new More(2), new Other(3), new Same(4)];

async function round(): Promise<void> {
  for (const source of sources) note("items", drain(source));
  for (const source of sources) note("load", await loadOf(source));
  for (const source of sources) note("stream", await follow(source));
}

await round();
Source.prototype.items = function* () {
  yield this.start * 1000;
};
More.prototype.load = async () => 7;
await round();
Other.prototype.items = () => [5, 6][Symbol.iterator]();
Source.prototype.load = () => Promise.resolve(8);
Same.prototype.stream = async function* () {
  yield 9;
};
await round();

export {};
