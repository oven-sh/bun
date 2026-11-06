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
async function later<T>(value: T): Promise<T> {
  await null;
  return value;
}

async function local(i: number): Promise<number> {
  const big = body();
  const n = size(big);
  await gate;
  return n + i;
}
async function fieldOfRecord(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  return n + request.id;
}
async function fieldOfInstance(i: number): Promise<number> {
  const call = new Call(body(), i);
  const n = size(call.body);
  await gate;
  return n + call.id;
}
async function methodOfInstance(i: number): Promise<number> {
  const call = new Call(body(), i);
  const n = size(call.body);
  await gate;
  return n + call.label();
}
async function destructured({ body, id }: Request): Promise<number> {
  const n = size(body);
  await gate;
  return n + id;
}
async function tryWithFinally(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  let n = 0;
  try {
    n += size(request.body);
    await gate;
  } finally {
    n += request.id;
  }
  return n;
}
async function tryWithCatch(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  let n = size(request.body);
  try {
    await gate;
    await Promise.reject(new Error("rejected"));
  } catch {
    n += request.id;
  }
  return n;
}
async function readAgainOnOneBranch(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  let n = size(request.body);
  const again = await later(i < 0);
  if (again) n += size(request.body);
  else await gate;
  return n + request.id;
}
async function deadAtSecondAwait(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  await null;
  const n = size(request.body);
  await gate;
  return n + request.id;
}
async function resultOfEarlierAwait(i: number): Promise<number> {
  const request: Request = await later({ body: body(), id: i, url: "/a" });
  const { body: big, id } = request;
  const n = size(big);
  await gate;
  return n + id;
}
async function recordInRecord(i: number): Promise<number> {
  const exchange: Exchange = { request: { body: body(), id: i, url: "/a" }, attempt: 1 };
  const n = size(exchange.request.body);
  await gate;
  return n + exchange.request.id + exchange.attempt;
}
async function tuple(i: number): Promise<number> {
  const pair: [Body, number] = [body(), i];
  const n = size(pair[0]);
  await gate;
  return n + pair[1];
}
async function storedToAfterAwait(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  request.id++;
  await null;
  return n + request.id;
}
async function restOfRecord(i: number): Promise<number> {
  const { body: big, ...rest }: Request = { body: body(), id: i, url: "/a" };
  const n = size(big);
  await gate;
  return n + rest.id;
}
async function recordInEveryRound(i: number): Promise<number> {
  let n = 0;
  for (let round = 0; round < 2; round++) {
    const request: Request = { body: body(), id: i, url: "/a" };
    n += size(request.body);
    await gate;
    n += request.id;
  }
  return n;
}
async function clearedField(i: number): Promise<number> {
  const request: { body: Body | undefined; id: number } = { body: body(), id: i };
  const n = size(request.body!);
  request.body = undefined;
  await gate;
  return n + request.id;
}
const arrowFunction = async (i: number): Promise<number> => {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  return n + request.id;
};
class Server {
  async handle(i: number): Promise<number> {
    const request: Request = { body: body(), id: i, url: "/a" };
    const n = size(request.body);
    await gate;
    return n + request.id;
  }
}
const server = new Server();
async function untypedRecord(i: number): Promise<number> {
  const request: any = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  return n + request.id;
}

// These must keep the body.
async function readAfterAwait(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  await gate;
  return size(request.body) + request.id;
}
async function mayEscapeAfterAwait(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  if (i === 3) leaked.push(request);
  return n + request.id;
}
async function escapedBeforeAwait(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  leaked.push(request);
  const n = size(request.body);
  await gate;
  return n + request.id;
}
async function readInCatch(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  try {
    await gate;
    await Promise.reject(new Error("rejected"));
    return 0;
  } catch {
    return size(request.body) + request.id;
  }
}

// Starts 16 calls, lets them reach `await gate`, collects garbage and counts the bodies that are still alive. The collector scans
// the stack conservatively, so a stale word may keep one or two of them.
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

await judge("a local", local);
await judge("a field of a record", fieldOfRecord);
await judge("a field of an instance", fieldOfInstance);
await judge("an instance whose method is called after the await", methodOfInstance);
await judge("a destructured parameter", i => destructured({ body: body(), id: i, url: "/a" }));
await judge("a record read in a finally block", tryWithFinally);
await judge("a record read in a catch block", tryWithCatch);
await judge("a record read again on one branch", readAgainOnOneBranch);
await judge("a field that is dead at the second await", deadAtSecondAwait);
await judge("the result of an earlier await", resultOfEarlierAwait);
await judge("a record in a record", recordInRecord);
await judge("a tuple", tuple);
await judge("a record stored to after the await", storedToAfterAwait);
await judge("the rest of a record", restOfRecord);
await judge("a record in every round of a loop", recordInEveryRound);
await judge("a field that is cleared", clearedField);
await judge("an arrow function", arrowFunction);
await judge("a method", i => server.handle(i));
await judge("an untyped record", untypedRecord);
await judge("a field read after the await", readAfterAwait);
await judge("a record that may escape after the await", mayEscapeAfterAwait);
await judge("a record that escaped before the await", escapedBeforeAwait);
await judge("a field read in a catch block", readInCatch);
