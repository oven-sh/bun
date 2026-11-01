declare function gc(): void;

class Body {
  bytes: number[] = new Array<number>(32).fill(1);
}
interface Request {
  body: Body;
  id: number;
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

// Generators. Each is judged while it is suspended at its last `yield 0`.
function* local(i: number): Generator<number, number> {
  const big = body();
  const n = size(big);
  yield 0;
  return n + i;
}
function* deadAtSecondYield(i: number): Generator<number, number> {
  const big = body();
  yield 0;
  const n = size(big);
  yield 0;
  return n + i;
}
function* deadOnOneBranch(i: number): Generator<number, number> {
  const big = body();
  yield 0;
  let n = i;
  if (i < 0) {
    yield 0;
    n += size(big);
  } else {
    n += 32;
    yield 0;
  }
  return n;
}
function* madeInEveryRound(i: number): Generator<number, number> {
  let n = i;
  for (let round = 0; round < 2; round++) {
    const big = body();
    yield 0;
    n += size(big);
    yield 0;
  }
  return n;
}
function* parameter(big: Body, i: number): Generator<number, number> {
  const n = size(big);
  yield 0;
  return n + i;
}
function* parameterDeadAtSecondYield(big: Body, i: number): Generator<number, number> {
  yield 0;
  const n = size(big);
  yield 0;
  return n + i;
}
function* destructuredParameter({ body, id }: Request): Generator<number, number> {
  const n = size(body);
  yield 0;
  return n + id;
}
class Upload {
  constructor(public body: Body) {}
  *parts(i: number): Generator<number, number> {
    const n = size(this.body);
    yield 0;
    return n + i;
  }
  async *chunks(i: number): AsyncGenerator<number> {
    const n = size(this.body);
    await gate;
    yield n + i;
  }
}
function* yielded(i: number): Generator<Body | number, number> {
  const big = body();
  yield big;
  yield 0;
  return 32 + i;
}
function* tryWithFinally(i: number): Generator<number, number> {
  const big = body();
  yield 0;
  let n = i;
  try {
    n += size(big);
    yield 0;
  } finally {
    n++;
  }
  return n;
}
function* caught(i: number): Generator<number, number> {
  const big = body();
  yield 0;
  let n = i;
  try {
    n += size(big);
    throw new Error("thrown");
  } catch {
    yield 0;
  }
  return n;
}
// These must keep the body.
function* readAfterYield(i: number): Generator<number, number> {
  const big = body();
  yield 0;
  yield 0;
  return size(big) + i;
}
function* parameterReadAfterYield(big: Body, i: number): Generator<number, number> {
  yield 0;
  return size(big) + i;
}
function* readInFinally(i: number): Generator<number, number> {
  const big = body();
  let n = i;
  try {
    yield 0;
    yield 0;
  } finally {
    n += size(big);
  }
  return n;
}
function* readInNextRound(big: Body, i: number): Generator<number, number> {
  let n = i;
  for (let round = 0; round < 2; round++) {
    n += size(big) / 2;
    yield 0;
  }
  return n;
}
function suspended(steps: number, generator: Generator<unknown, number>): Promise<number> {
  for (let step = 0; step < steps; step++) generator.next();
  return gate.then(() => {
    for (;;) {
      const { done, value } = generator.next();
      if (done) return value as number;
    }
  });
}

// Async generators. Each is judged while it is suspended at `await gate`.
async function* localOfAsync(i: number): AsyncGenerator<number> {
  const big = body();
  const n = size(big);
  await gate;
  yield n + i;
}
async function* deadAtSecondAwait(i: number): AsyncGenerator<number> {
  const big = body();
  await null;
  const n = size(big);
  await gate;
  yield n + i;
}
async function* parameterOfAsync(big: Body, i: number): AsyncGenerator<number> {
  const n = size(big);
  await gate;
  yield n + i;
}
async function* destructuredParameterOfAsync({ body, id }: Request): AsyncGenerator<number> {
  const n = size(body);
  await gate;
  yield n + id;
}
async function* yieldedByAsync(i: number): AsyncGenerator<number> {
  const big = body();
  yield size(big);
  await gate;
  yield i;
}
async function* awaited(i: number): AsyncGenerator<number> {
  const big = await Promise.resolve(body());
  const n = size(big);
  await gate;
  yield n + i;
}
async function* tryWithFinallyInAsync(i: number): AsyncGenerator<number> {
  const big = body();
  await null;
  let n = i;
  try {
    n += size(big);
    await gate;
  } finally {
    n++;
  }
  yield n;
}
// These must keep the body.
async function* readAfterAwait(i: number): AsyncGenerator<number> {
  const big = body();
  await null;
  await gate;
  yield size(big) + i;
}
async function* parameterReadAfterAwait(big: Body, i: number): AsyncGenerator<number> {
  await gate;
  yield size(big) + i;
}
async function drained(generator: AsyncGenerator<number>): Promise<number> {
  let sum = 0;
  for await (const n of generator) sum += n;
  return sum;
}

// Starts 16 generators, lets them get to where they wait for the gate, collects garbage and counts the bodies that are still
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

console.log("generators");
await judge("a local", i => suspended(1, local(i)));
await judge("a local that is dead at the second yield", i => suspended(2, deadAtSecondYield(i)));
await judge("a local that is dead on one branch", i => suspended(2, deadOnOneBranch(i)));
await judge("a local made in every round of a loop", i => suspended(2, madeInEveryRound(i)));
await judge("a parameter", i => suspended(1, parameter(body(), i)));
await judge("a parameter that is dead at the second yield", i => suspended(2, parameterDeadAtSecondYield(body(), i)));
await judge("a destructured parameter", i => suspended(1, destructuredParameter({ body: body(), id: i })));
await judge("the receiver", i => suspended(1, new Upload(body()).parts(i)));
await judge("a value that was yielded", i => suspended(2, yielded(i)));
await judge("a local read in a try block", i => suspended(2, tryWithFinally(i)));
await judge("a local that is dead in the catch block", i => suspended(2, caught(i)));
await judge("a local read after the yield", i => suspended(2, readAfterYield(i)));
await judge("a parameter read after the yield", i => suspended(1, parameterReadAfterYield(body(), i)));
await judge("a local read in a finally block", i => suspended(2, readInFinally(i)));
await judge("a parameter read in the next round of a loop", i => suspended(1, readInNextRound(body(), i)));
console.log("async generators");
await judge("a local", i => drained(localOfAsync(i)));
await judge("a local that is dead at the second await", i => drained(deadAtSecondAwait(i)));
await judge("a parameter", i => drained(parameterOfAsync(body(), i)));
await judge("a destructured parameter", i => drained(destructuredParameterOfAsync({ body: body(), id: i })));
await judge("the receiver", i => drained(new Upload(body()).chunks(i)));
await judge("a local read before a yield", i => drained(yieldedByAsync(i)));
await judge("the result of an earlier await", i => drained(awaited(i)));
await judge("a local read in a try block", i => drained(tryWithFinallyInAsync(i)));
await judge("a local read after the await", i => drained(readAfterAwait(i)));
await judge("a parameter read after the await", i => drained(parameterReadAfterAwait(body(), i)));
