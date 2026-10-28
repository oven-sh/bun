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

function* parts(): Generator<Body> {
  yield body();
  yield body();
}
function written(): Iterable<Body> {
  let n = 0;
  return {
    [Symbol.iterator]() {
      return {
        next(): IteratorResult<Body> {
          return n++ < 2 ? { value: body(), done: false } : { value: undefined, done: true };
        },
      };
    },
  };
}
function mapped(): IteratorObject<Body> {
  return [1, 2].values().map(() => body());
}

async function consume(source: Iterable<Body>, i: number): Promise<number> {
  let n = i;
  for (const chunk of source) {
    n += size(chunk);
    await gate;
  }
  return n;
}
async function consumeFirstOfPattern(source: Iterable<Body>, i: number): Promise<number> {
  const [first] = source;
  const n = size(first);
  await gate;
  return n + 32 + i;
}
function* consumeInGenerator(source: Iterable<Body>, i: number): Generator<number, number> {
  let n = i;
  for (const chunk of source) {
    n += size(chunk);
    yield 0;
  }
  return n;
}
async function consumeAndReadAgain(source: Iterable<Body>, i: number): Promise<number> {
  let n = i;
  for (const chunk of source) {
    await gate;
    n += size(chunk);
  }
  return n;
}
function suspended(generator: Generator<number, number>): Promise<number> {
  generator.next();
  return gate.then(() => {
    for (;;) {
      const { done, value } = generator.next();
      if (done) return value;
    }
  });
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

await judge("a generator", i => consume(parts(), i));
await judge("an iterator that the program wrote", i => consume(written(), i));
await judge("an iterator helper", i => consume(mapped(), i));
await judge("an array pattern", i => consumeFirstOfPattern(parts(), i));
await judge("a loop in a generator", i => suspended(consumeInGenerator(parts(), i)));
await judge("a loop in a generator over an iterator that the program wrote", i => suspended(consumeInGenerator(written(), i)));
await judge("a value read after the await", i => consumeAndReadAgain(parts(), i));
