declare function gc(): void;

class Body {
  bytes: number[] = new Array<number>(32).fill(1);
}
interface Request {
  body: Body;
  id: number;
  url: string;
}
class Call {
  constructor(
    public body: Body,
    public id: number,
  ) {}
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
function describe(request: Request): number {
  return request.id + request.url.length;
}
function describeIfAny(request: Request | undefined): number {
  return request ? request.id + request.url.length : 0;
}
function label(call: Call): number {
  return call.id * 2;
}
function keep(request: Request): number {
  leaked.push(request);
  return request.id + request.url.length;
}
function weigh(request: Request): number {
  return request.id + size(request.body);
}

async function readsTwoFields(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  return n + describe(request);
}
async function readsTwoFieldsIfAny(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  return n + describeIfAny(request);
}
async function readsFieldOfInstance(i: number): Promise<number> {
  const call = new Call(body(), i);
  const n = size(call.body);
  await gate;
  return n + label(call);
}
async function readsTwice(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body) + describe(request);
  await gate;
  return n + describe(request);
}
// These must keep the body.
async function keepsObject(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  const n = size(request.body);
  await gate;
  return n + keep(request);
}
async function readsBody(i: number): Promise<number> {
  const request: Request = { body: body(), id: i, url: "/a" };
  await gate;
  return weigh(request);
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

await judge("a function that reads two fields", readsTwoFields);
await judge("a function that tests the object and reads two fields", readsTwoFieldsIfAny);
await judge("a function that reads a field of an instance", readsFieldOfInstance);
await judge("called before and after the await", readsTwice);
await judge("a function that keeps the object", keepsObject);
await judge("a function that reads the body", readsBody);
