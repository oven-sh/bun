// A request handler that waits keeps alive only what it and its listeners still refer to: the body it has read is collected while its timer, its event listener and its abort listener stay.
// "an event listener" says what plain Bun says too: `body` is stored to by a closure, so it lies in the one environment of the scope, which the listener holds for `events`: the second buffer
// stays. The stored output may get better one day.
let round = 0;
let made = 0;
let collected = 0;
const registry = new FinalizationRegistry<number>(madeIn => {
  if (madeIn === round) collected++;
});
function watch<T extends object>(value: T): T {
  made++;
  registry.register(value, round);
  return value;
}
function once(f: () => number): number {
  return f();
}
let total = 0;
let release: () => void = () => {};
let parked: Promise<void> = Promise.resolve();
const timers: ReturnType<typeof setInterval>[] = [];
const target = new EventTarget();
let controller = new AbortController();

async function withAnAbortListener(request: Request) {
  const body = watch(await request.arrayBuffer());
  let state = 0;
  controller.signal.addEventListener("abort", () => {
    state++;
  });
  total += once(() => body.byteLength);
  await parked;
  return state;
}
async function withAnInterval(request: Request) {
  const body = watch(await request.arrayBuffer());
  let ticks = 0;
  timers.push(setInterval(() => {
    ticks++;
  }, 1000));
  total += once(() => body.byteLength);
  await parked;
  return ticks;
}
async function withAnEventListener(request: Request) {
  let body = watch(await request.arrayBuffer());
  let events = 0;
  target.addEventListener("ping", () => {
    events++;
  });
  total += once(() => {
    const length = body.byteLength;
    body = watch(new ArrayBuffer(8));
    return length;
  });
  await parked;
  return events;
}
async function withAResponse(request: Request) {
  const response = watch(new Response(await request.arrayBuffer()));
  let status = 0;
  const finish = () => ++status;
  total += once(() => response.status);
  await parked;
  return finish();
}
function notAsync(request: Request) {
  const copy = watch(request.clone());
  let calls = 0;
  total += once(() => copy.url.length);
  target.addEventListener("ping", () => {
    calls++;
  });
  return parked.then(() => calls);
}

async function judge(name: string, handler: (request: Request) => Promise<number>) {
  round++;
  made = collected = 0;
  controller = new AbortController();
  parked = new Promise<void>(resolve => {
    release = resolve;
  });
  const results: Promise<number>[] = [];
  for (let i = 0; i < 16; i++) results.push(handler(new Request("http://localhost/", { method: "POST", body: new Uint8Array(1024) })));
  for (let i = 0; i < 4; i++) {
    await Bun.sleep(1);
    Bun.gc(true);
  }
  await Bun.sleep(1);
  const verdict = collected * 4 >= made * 3 ? "collected" : collected * 4 <= made ? "kept" : collected + " of " + made;
  controller.abort();
  target.dispatchEvent(new Event("ping"));
  release();
  let sum = 0;
  for (const result of results) sum += await result;
  for (const timer of timers.splice(0)) clearInterval(timer);
  console.log(name + ": " + verdict + ", " + sum);
}

await judge("an abort listener", withAnAbortListener);
await judge("an interval", withAnInterval);
await judge("an event listener", withAnEventListener);
await judge("a response", withAResponse);
await judge("not async", notAsync);
console.log(total);
/* Output:
an abort listener: collected, 16
an interval: collected, 0
an event listener: 16 of 32, 16
a response: collected, 16
not async: collected, 16
52624
*/
