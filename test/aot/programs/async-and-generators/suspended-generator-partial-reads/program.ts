declare function gc(): void;

class Body {
  bytes: number[] = new Array<number>(32).fill(1);
}
interface Request {
  body: Body;
  id: number;
  url: string;
}
interface Exchange {
  request: Request;
  attempt: number;
}
class Call {
  constructor(
    public body: Body,
    public id: number,
  ) {}
  label(): number {
    return this.id * 2;
  }
}

let watched: WeakRef<Body>[] = [];
let leaked: unknown[] = [];
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
function* fieldOfRecord(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  yield 0;
  return n + request.id;
}
function* fieldOfInstance(i: number): Generator<number, number> {
  const call = new Call(body(), i);
  const n = size(call.body);
  yield 0;
  return n + call.id;
}
function* methodOfInstance(i: number): Generator<number, number> {
  const call = new Call(body(), i);
  const n = size(call.body);
  yield 0;
  return n + call.label();
}
function* recordInRecord(i: number): Generator<number, number> {
  const exchange: Exchange = { request: { body: body(), id: i, url: "/a" }, attempt: 1 };
  const n = size(exchange.request.body);
  yield 0;
  return n + exchange.request.id + exchange.attempt;
}
function* tuple(i: number): Generator<number, number> {
  const pair: [Body, number] = [body(), i];
  const n = size(pair[0]);
  yield 0;
  return n + pair[1];
}
function* storedToAfterYield(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  yield 0;
  request.id++;
  yield 0;
  return n + request.id;
}
function* deadAtSecondYield(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  yield 0;
  const n = size(request.body);
  yield 0;
  return n + request.id;
}
function* recordInEveryRound(i: number): Generator<number, number> {
  let n = 0;
  for (let round = 0; round < 2; round++) {
    const request: Request = { body: body(), id: i, url: "/a" };
    n += size(request.body);
    yield 0;
    n += request.id;
  }
  return n;
}
function* readInFinally(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  let n = 0;
  try {
    n += size(request.body);
    yield 0;
  } finally {
    n += request.id;
  }
  return n;
}
function* untypedRecord(i: number): Generator<number, number> {
  const request: any = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  yield 0;
  return n + request.id;
}
// These must keep the body.
function* readAfterYield(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  yield 0;
  return size(request.body) + request.id;
}
function* mayEscapeAfterYield(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  yield 0;
  if (i === 3) leaked.push(request);
  return n + request.id;
}
function* escapedBeforeYield(i: number): Generator<number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  leaked.push(request);
  const n = size(request.body);
  yield 0;
  return n + request.id;
}
function* yieldedItself(i: number): Generator<Request | number, number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const sent = yield request;
  yield 0;
  return size(request.body) + request.id + (sent === undefined ? 0 : 1);
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
async function* fieldOfRecordInAsync(i: number): AsyncGenerator<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  yield n + request.id;
}
async function* fieldOfInstanceInAsync(i: number): AsyncGenerator<number> {
  const call = new Call(body(), i);
  const n = size(call.body);
  await gate;
  yield n + call.id;
}
async function* recordInEveryRoundInAsync(i: number): AsyncGenerator<number> {
  for (let round = 0; round < 2; round++) {
    const request: Request = { body: body(), id: i, url: "/a" };
    const n = size(request.body);
    await gate;
    yield n + request.id;
  }
}
async function* readInCatchInAsync(i: number): AsyncGenerator<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  try {
    await gate;
    await Promise.reject(new Error("rejected"));
  } catch {
    yield n + request.id;
  }
}
// This must keep the body.
async function* readAfterAwait(i: number): AsyncGenerator<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  await gate;
  yield size(request.body) + request.id;
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
  leaked = [];
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
await judge("a field of a record", i => suspended(1, fieldOfRecord(i)));
await judge("a field of an instance", i => suspended(1, fieldOfInstance(i)));
await judge("an instance whose method is called after the yield", i => suspended(1, methodOfInstance(i)));
await judge("a record in a record", i => suspended(1, recordInRecord(i)));
await judge("a tuple", i => suspended(1, tuple(i)));
await judge("a record stored to after the yield", i => suspended(1, storedToAfterYield(i)));
await judge("a field that is dead at the second yield", i => suspended(2, deadAtSecondYield(i)));
await judge("a record in every round of a loop", i => suspended(1, recordInEveryRound(i)));
await judge("a record read in a finally block", i => suspended(1, readInFinally(i)));
await judge("an untyped record", i => suspended(1, untypedRecord(i)));
await judge("a field read after the yield", i => suspended(1, readAfterYield(i)));
await judge("a record that may escape after the yield", i => suspended(1, mayEscapeAfterYield(i)));
await judge("a record that escaped before the yield", i => suspended(1, escapedBeforeYield(i)));
await judge("a record that was yielded", i => suspended(2, yieldedItself(i)));
console.log("async generators");
await judge("a field of a record", i => drained(fieldOfRecordInAsync(i)));
await judge("a field of an instance", i => drained(fieldOfInstanceInAsync(i)));
await judge("a record in every round of a loop", i => drained(recordInEveryRoundInAsync(i)));
await judge("a record read in a catch block", i => drained(readInCatchInAsync(i)));
await judge("a field read after the await", i => drained(readAfterAwait(i)));
