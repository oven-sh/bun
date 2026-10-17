declare function gc(): void;

class Body {
  bytes: number[] = new Array<number>(32).fill(1);
}

let watched: WeakRef<Body>[] = [];
let open: () => void = () => {};
let gate: Promise<void> = Promise.resolve();

function body(): Body {
  const made = new Body();
  watched.push(new WeakRef(made));
  return made;
}
function size(of: Body): number {
  return of.bytes.length;
}
function turn(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

async function* chunks(): AsyncGenerator<Body> {
  yield body();
  yield body();
}
async function* chunksThatArriveLater(): AsyncGenerator<Body> {
  await null;
  yield body();
  await null;
  yield body();
}
function* parts(): Generator<Body> {
  yield body();
  yield body();
}
async function* delegating(): AsyncGenerator<Body> {
  yield* chunks();
}
async function* delegatingToSync(): AsyncGenerator<Body> {
  yield* parts();
}

async function consume(source: AsyncIterable<Body> | Iterable<Body>, i: number): Promise<number> {
  let n = i;
  for await (const chunk of source) {
    n += size(chunk);
    await gate;
  }
  return n;
}
async function* consumeInGenerator(source: AsyncIterable<Body>, i: number): AsyncGenerator<number> {
  let n = i;
  for await (const chunk of source) {
    n += size(chunk);
    await gate;
  }
  yield n;
}
async function consumeAndReadAgain(source: AsyncIterable<Body>, i: number): Promise<number> {
  let n = i;
  for await (const chunk of source) {
    await gate;
    n += size(chunk);
  }
  return n;
}
async function first(generator: AsyncGenerator<number>): Promise<number> {
  return (await generator.next()).value;
}

// Starts 16 loops, lets each take its first value and wait for the gate, collects garbage and counts the bodies that are still
// alive. The collector scans the stack conservatively, so a stale word may keep one or two of them.
async function judge(name: string, start: (i: number) => Promise<number>): Promise<void> {
  watched = [];
  gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const running: Promise<number>[] = [];
  for (let i = 0; i < 16; i++) running.push(start(i));
  await turn();
  gc();
  let alive = 0;
  for (const each of watched) if (each.deref()) alive++;
  const verdict = alive <= 2 ? "collected" : alive === watched.length ? "kept" : alive + " of " + watched.length + " kept";
  open();
  let sum = 0;
  for (const each of running) sum += await each;
  console.log(name + ": " + verdict + ", " + sum);
}

await judge("an async generator", i => consume(chunks(), i));
await judge("an async generator that awaits before it yields", i => consume(chunksThatArriveLater(), i));
await judge("a generator", i => consume(parts(), i));
await judge("yield* over an async generator", i => consume(delegating(), i));
await judge("yield* over a generator", i => consume(delegatingToSync(), i));
await judge("a loop in an async generator", i => first(consumeInGenerator(chunks(), i)));
await judge("a value read after the await", i => consumeAndReadAgain(chunks(), i));

// The result objects of an iterator that the program wrote are the program's: they stay as they are.
const handedOut: IteratorResult<number>[] = [];
const written: AsyncIterable<number> = {
  [Symbol.asyncIterator]() {
    let n = 0;
    return {
      next() {
        const result: IteratorResult<number> = n < 3 ? { value: ++n, done: false } : { value: undefined, done: true };
        handedOut.push(result);
        return Promise.resolve(result);
      },
    };
  },
};
const borrowed: AsyncIterable<number> = {
  [Symbol.asyncIterator]() {
    const inner = [4, 5, 6].values();
    return {
      next() {
        const result = inner.next();
        handedOut.push(result);
        return Promise.resolve(result);
      },
    };
  },
};
async function* forwarded(): AsyncGenerator<number> {
  yield* written;
  yield* borrowed;
}
let total = 0;
for await (const n of written) total += n;
for await (const n of borrowed) total += n;
for await (const n of forwarded()) total += n;
console.log(total, JSON.stringify(handedOut.map(result => result.value ?? null)));

// Calling next() by hand gives fresh result objects, which keep their values.
const byHand = chunks();
const one = await byHand.next();
const two = await byHand.next();
for await (const rest of byHand) size(rest);
console.log(size(one.value), size(two.value), one !== two);
