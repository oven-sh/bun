// A generator or an async function reads its parameters after the call has returned, when the caller's frame is gone: every parameter of a coroutine is kept, and so is whatever a function captures in a closure that it hands to a promise or a timer.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Point {
  x: number;
  y: number;
  tag: string;
}
function* walk(p: Point, steps: number): Generator<string, Point, unknown> {
  for (let i = 0; i < steps; i++) yield p.tag + ":" + (p.x + i);
  return p;
}
function* neverStartedAtFirst(p: Point, read: () => number = () => p.y): Generator<number> {
  yield read() + p.x;
}
async function afterAnAwait(p: Point): Promise<string> {
  await null;
  return p.tag + ":" + p.y;
}
const asyncArrow = async (p: Point, read: () => number): Promise<number> => {
  const before = read();
  await undefined;
  return before * 1000 + read() + p.x;
};
class Service {
  async method(p: Point): Promise<Point> {
    await 0;
    return p;
  }
  async *stream(p: Point): AsyncGenerator<string> {
    yield p.tag + " first";
    await null;
    yield p.tag + " second";
  }
}
function notACoroutineButLater(p: Point): Promise<string> {
  return Promise.resolve().then(() => p.tag + " in a reaction");
}
function byTimer(p: Point, done: (text: string) => void): void {
  setTimeout(() => done(p.tag + " in a timer"), 0);
}
function startAll(i: number) {
  let counter = i;
  const generator = walk({ x: i, y: -i, tag: "walk" + i }, 2);
  const waiting = neverStartedAtFirst({ x: i, y: i * 2, tag: "waiting" + i });
  const withClosure = neverStartedAtFirst({ x: 1, y: 1, tag: "w" }, () => counter);
  const first = afterAnAwait({ x: i, y: i + 1, tag: "await" + i });
  const second = asyncArrow({ x: i, y: 0, tag: "arrow" + i }, () => counter);
  const service = new Service();
  const third = service.method({ x: i, y: 0, tag: "method" + i });
  const stream = service.stream({ x: i, y: 0, tag: "stream" + i });
  const fourth = notACoroutineButLater({ x: 0, y: 0, tag: "reaction" + i });
  counter += 5;
  return { generator, waiting, withClosure, first, second, third, stream, fourth };
}
const started: ReturnType<typeof startAll>[] = [];
for (let i = 0; i < 120; i++) {
  const all = startAll(i);
  if (i % 40 === 39) started.push(all);
  else all.generator.next();
}
console.log(churn(80));
for (const all of started) {
  const steps = [all.generator.next(), all.generator.next(), all.generator.next()];
  console.log(steps.map(s => (typeof s.value === "string" ? s.value : "returned " + s.value.tag) + (s.done ? " done" : "")).join(" | "));
  console.log(all.waiting.next().value, all.withClosure.next().value);
}
const timers: string[] = [];
for (let i = 0; i < 3; i++) byTimer({ x: 0, y: 0, tag: "timer" + i }, text => timers.push(text));
churn(80);
for (const all of started) {
  console.log(await all.first, await all.second, (await all.third).tag, await all.fourth);
  churn(20);
  const parts: string[] = [];
  for await (const part of all.stream) parts.push(part);
  console.log(parts.join(" | "));
}
await new Promise(resolve => setTimeout(resolve, 5));
console.log(timers.join(" | "));

// A generator hands out what it was handed, and takes in what the caller sends.
function* relay(first: Point): Generator<Point, Point[], Point> {
  const got: Point[] = [first];
  for (let i = 0; i < 3; i++) got.push(yield got[got.length - 1]);
  return got;
}
function drive(i: number): string {
  const mine = { x: i, y: i, tag: "mine" + i };
  const it = relay(mine);
  const a = it.next().value as Point;
  const sent = { x: 1, y: 1, tag: "sent" + i };
  const b = it.next(sent).value as Point;
  churn(10);
  it.next({ x: 2, y: 2, tag: "second" + i });
  const all = it.next({ x: 3, y: 3, tag: "third" + i }).value as Point[];
  return (a === mine) + " " + (b === sent) + " " + all.map(p => p.tag).join();
}
let last = "";
for (let i = 0; i < 100; i++) last = drive(i);
console.log(last);
